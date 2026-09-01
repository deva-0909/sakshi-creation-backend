const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, deriveInitials, evaluateInvoiceQuantityAgainstDelivery } = require("../lib/helpers");
const { resolveCompanyScope } = require("../lib/companyScope");
const { logAudit } = require("../lib/audit");
const { notifyStatusChange } = require("../lib/notify");
const { buildInvoicePdf, streamPdf } = require("../lib/pdf");

// Patch 131 (invoice/delivery linkage): sums how much of `orderId` has
// actually been delivered (delivery_challans.quantity_delivered, per-challan
// against the order -- an order can have several partial-delivery challans)
// versus how much of it has already been invoiced (invoice_items.quantity
// across this order's other non-deleted invoices). Order-total granularity
// only -- orders have a single flat `qty`, no order line items, and
// invoice_items has no FK back to an order line, so a precise per-line
// reconciliation isn't derivable from the real schema. Shared by the
// createInvoice guard and the GET /invoices/remaining-quantity/:orderId
// endpoint so both agree on the same numbers.
async function getOrderDeliveryAndInvoiceTotals(orderId) {
  const { data: challans, error: challanErr } = await supabase
    .from("delivery_challans")
    .select("quantity_delivered")
    .eq("order_id", orderId)
    .eq("is_delete", false)
    .in("status", ["Dispatched", "Delivered"]);
  if (challanErr) throw challanErr;
  const deliveredQty = (challans || []).reduce((sum, c) => sum + (Number(c.quantity_delivered) || 0), 0);

  const { data: invoices, error: invErr } = await supabase
    .from("invoices")
    .select("id")
    .eq("order_id", orderId)
    .eq("is_delete", false)
    .neq("status", "Cancelled");
  if (invErr) throw invErr;
  const invoiceIds = (invoices || []).map((i) => i.id);

  let invoicedQty = 0;
  if (invoiceIds.length) {
    const { data: items, error: itemsErr } = await supabase.from("invoice_items").select("quantity, invoice_id").in("invoice_id", invoiceIds);
    if (itemsErr) throw itemsErr;
    invoicedQty = (items || []).reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
  }

  return { deliveredQty, invoicedQty };
}

const SELECT = `
  id, invoiceNumber:invoice_number, invoiceDate:invoice_date, dueDate:due_date, gstType:gst_type,
  subtotal, cgstAmount:cgst_amount, sgstAmount:sgst_amount, igstAmount:igst_amount,
  grandTotal:grand_total, amountPaid:amount_paid, status, notes, orderId:order_id, quotationId:quotation_id,
  createdAt:created_at, updatedAt:updated_at,
  companyName:company_name_id(id, companyName:company_name),
  party:party_id(id, partyName:party_name, gstNo:gst_no),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

const ITEM_SELECT = `
  id, description, hsnCode:hsn_code, quantity, unitPrice:unit_price, gstRate:gst_rate,
  taxableAmount:taxable_amount, lineTotal:line_total
`;

// Only Draft/Issued are user-driven transitions here; Partially Paid/Paid
// are set automatically inside record_receipt_transactional once receipts
// are posted against this invoice, never via this transition map -- same
// pattern as Purchase Order's Partially Received/Received (Module 3).
const ALLOWED_TRANSITIONS = {
  Draft: ["Issued", "Cancelled"],
  Issued: ["Cancelled"],
};

async function recordHistory({ invoiceId, fromStatus, toStatus, changedBy, remarks }) {
  const { error } = await supabase.from("invoice_status_history").insert({
    invoice_id: invoiceId,
    from_status: fromStatus,
    to_status: toStatus,
    changed_by: changedBy || null,
    remarks: remarks || null,
  });
  if (error) console.error("Invoice status history insert failed:", error.message);
}

async function transition(req, res, { toStatus, requireRemarksField } = {}) {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid invoice ID" });
    }
    const { data: invoice } = await supabase.from("invoices").select("id, status, created_by").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    const allowed = ALLOWED_TRANSITIONS[invoice.status] || [];
    if (!allowed.includes(toStatus)) {
      return res.status(400).json({ success: false, message: `Cannot move an invoice from '${invoice.status}' to '${toStatus}'` });
    }
    if (requireRemarksField && !req.body[requireRemarksField]) {
      return res.status(400).json({ success: false, message: `${requireRemarksField} is required` });
    }

    const updateData = {
      status: toStatus,
      updated_by: req.user?.id || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from("invoices").update(updateData).eq("id", id).select(SELECT).single();
    if (error) throw error;

    await recordHistory({
      invoiceId: id,
      fromStatus: invoice.status,
      toStatus,
      changedBy: req.user?.id || null,
      remarks: requireRemarksField ? req.body[requireRemarksField] : req.body.remarks,
    });

    logAudit({ req, action: "update", module: "invoice", recordId: id, newValue: { status: toStatus } });

    await notifyStatusChange({
      moduleKey: "invoice",
      entityType: "invoice",
      entityId: id,
      creatorId: invoice.created_by,
      actorId: req.user?.id || null,
      toStatus,
      title: `Invoice ${data.invoiceNumber} -> ${toStatus}`,
      message: `Invoice ${data.invoiceNumber} moved from ${invoice.status} to ${toStatus}.`,
      link: `/admin/accounting/invoices/view/${id}`,
    });

    return { data };
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating invoice status: " + error.message });
    return null;
  }
}

// GST type is never client-supplied -- it's derived here by comparing the
// billing company's state to the party's state, per the design decision to
// auto-detect rather than let the user pick per-invoice. Both states must
// be set before an invoice can be raised, so a stale/unmigrated company or
// party record surfaces as a clear validation error instead of silently
// defaulting to the wrong GST treatment.
function deriveGstType(companyState, partyState) {
  if (!companyState || !partyState) return null;
  return companyState.trim().toLowerCase() === partyState.trim().toLowerCase() ? "CGST_SGST" : "IGST";
}

exports.createInvoice = async (req, res) => {
  try {
    const { companyName, partyId, orderId, quotationId, invoiceDate, dueDate, notes, items } = req.body;
    if (!isValidId(companyName) || !isValidId(partyId)) {
      return res.status(400).json({ success: false, message: "Invalid company or party ID" });
    }
    if (orderId && !isValidId(orderId)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }
    if (quotationId && !isValidId(quotationId)) {
      return res.status(400).json({ success: false, message: "Invalid quotation ID" });
    }

    const { data: company } = await supabase.from("company_names").select("id, company_name, state").eq("id", companyName).maybeSingle();
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }
    const { data: party } = await supabase.from("parties").select("id, state").eq("id", partyId).eq("is_delete", false).maybeSingle();
    if (!party) {
      return res.status(404).json({ success: false, message: "Party not found" });
    }
    if (orderId) {
      const { data: order } = await supabase.from("orders").select("id").eq("id", orderId).maybeSingle();
      if (!order) {
        return res.status(404).json({ success: false, message: "Order not found" });
      }
    }
    if (quotationId) {
      const { data: quotation } = await supabase.from("quotations").select("id").eq("id", quotationId).eq("is_delete", false).maybeSingle();
      if (!quotation) {
        return res.status(404).json({ success: false, message: "Quotation not found" });
      }
    }

    const gstType = deriveGstType(company.state, party.state);
    if (!gstType) {
      return res.status(400).json({
        success: false,
        message: "Set a state on both the company and the party before raising an invoice (needed to determine CGST/SGST vs IGST)",
      });
    }

    // Patch 131 (invoice/delivery linkage): only guarded when this invoice
    // is linked to an order -- freeform/quotation-only invoices skip this
    // entirely, as do proforma/advance invoices, which go through the
    // wholly separate performance-invoice controller and table, not this
    // one. Rejects (400) before the RPC/DB write if the requested line-item
    // total would push the order's invoiced-quantity total past what's
    // actually been delivered for it.
    if (orderId) {
      const requestedQty = (items || []).reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
      const { deliveredQty, invoicedQty } = await getOrderDeliveryAndInvoiceTotals(orderId);
      const guard = evaluateInvoiceQuantityAgainstDelivery({
        deliveredQty,
        alreadyInvoicedQty: invoicedQty,
        requestedQty,
      });
      if (!guard.ok) {
        return res.status(400).json({ success: false, message: guard.message });
      }
    }

    const initials = deriveInitials(company.company_name);

    const { data: invoiceId, error } = await supabase.rpc("create_invoice_transactional", {
      p_company_name_id: companyName,
      p_party_id: partyId,
      p_order_id: orderId || null,
      p_quotation_id: quotationId || null,
      p_invoice_date: invoiceDate,
      p_due_date: dueDate || null,
      p_gst_type: gstType,
      p_notes: notes || null,
      p_created_by: req.user?.id || null,
      p_initials: initials,
      p_items: items.map((i) => ({
        description: i.description,
        hsnCode: i.hsnCode || null,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        gstRate: Number(i.gstRate),
      })),
    });
    if (error) throw error;

    const { data: populated } = await supabase.from("invoices").select(SELECT).eq("id", invoiceId).single();
    logAudit({ req, action: "create", module: "invoice", recordId: invoiceId, newValue: populated });

    res.status(201).json({ success: true, message: "Invoice created successfully", data: withMongoId(populated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating invoice: " + error.message });
  }
};

exports.getAllInvoices = async (req, res) => {
  try {
    const { status, partyId, companyName, search, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("invoices").select(SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    if (partyId) query = query.eq("party_id", partyId);
    // QP order-process audit (2026-08-25): the established two-company
    // list-filter pattern (companyName query param -> company_name_id
    // .eq()) was applied to every other module but never came back to this
    // one -- there was no way to list "just Quality Packaging's invoices".
    if (companyName) {
      query = query.eq("company_name_id", companyName);
    } else {
      // Tier 1 security audit fix (2026-09-01), Fix 1: fall back to the
      // caller's own company when none was requested -- see
      // lib/companyScope.js.
      const scope = await resolveCompanyScope(req);
      if (scope.scoped) query = query.eq("company_name_id", scope.companyId);
    }
    if (search && String(search).trim()) query = query.ilike("invoice_number", `%${String(search).trim()}%`);
    // Multi-role audit fix (Finding 1): authorizeView() attaches this when the
    // caller's role only has view_own (not view_global) for this module.
    if (req.viewOwnFilter) query = query.eq(req.viewOwnFilter.column, req.viewOwnFilter.value);

    let pageNum, limitNum, from;
    if (paginate) {
      pageNum = parseInt(page, 10) || 1;
      limitNum = parseInt(limit, 10) || 10;
      from = (pageNum - 1) * limitNum;
      query = query.range(from, from + limitNum - 1);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const response = { success: true, count: data.length, data: withMongoId(data) };
    if (paginate) {
      response.pagination = {
        currentPage: pageNum,
        totalPages: Math.ceil(count / limitNum),
        totalCount: count,
        hasNext: from + data.length < count,
        hasPrev: pageNum > 1,
      };
    }
    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching invoices: " + error.message });
  }
};

exports.getInvoiceById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid invoice ID" });
    }
    const { data: invoice, error } = await supabase.from("invoices").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    const { data: items } = await supabase.from("invoice_items").select(ITEM_SELECT).eq("invoice_id", id);
    res.status(200).json({ success: true, data: withMongoId({ ...invoice, items: items || [] }) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching invoice: " + error.message });
  }
};

exports.getInvoicePdf = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid invoice ID" });
    }
    const { data: invoice, error } = await supabase.from("invoices").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    const { data: items } = await supabase.from("invoice_items").select(ITEM_SELECT).eq("invoice_id", id);
    const doc = await buildInvoicePdf(invoice, items || []);
    streamPdf(res, doc, `${invoice.invoiceNumber}.pdf`);
  } catch (error) {
    res.status(500).json({ success: false, message: "Error generating invoice PDF: " + error.message });
  }
};

exports.deleteInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid invoice ID" });
    }
    const { data: existing } = await supabase.from("invoices").select("id, status").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!existing) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    if (existing.status !== "Draft") {
      return res.status(400).json({ success: false, message: "Only a Draft invoice can be deleted" });
    }
    const { error } = await supabase.from("invoices").update({ is_delete: true }).eq("id", id);
    if (error) throw error;
    logAudit({ req, action: "delete", module: "invoice", recordId: id });
    res.status(200).json({ success: true, message: "Invoice deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting invoice: " + error.message });
  }
};

exports.issueInvoice = async (req, res) => {
  const result = await transition(req, res, { toStatus: "Issued" });
  if (result) res.status(200).json({ success: true, message: "Invoice issued", data: withMongoId(result.data) });
};

exports.cancelInvoice = async (req, res) => {
  const result = await transition(req, res, { toStatus: "Cancelled", requireRemarksField: "remarks" });
  if (result) res.status(200).json({ success: true, message: "Invoice cancelled", data: withMongoId(result.data) });
};

exports.getInvoiceHistory = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid invoice ID" });
    }
    const { data, error } = await supabase
      .from("invoice_status_history")
      .select("id, fromStatus:from_status, toStatus:to_status, remarks, createdAt:created_at, changedBy:changed_by(id, firstName:first_name, lastName:last_name)")
      .eq("invoice_id", id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching invoice history: " + error.message });
  }
};

// Patch 131 (invoice/delivery linkage): lightweight lookup the invoice
// dialog calls when an order is selected, so the user sees how much of the
// order is still un-invoiced *before* submitting -- the createInvoice guard
// above is what actually enforces it, this is just a preview for the UI.
exports.getRemainingQuantityForOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!isValidId(orderId)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }
    const { data: order } = await supabase.from("orders").select("id, qty, order_number").eq("id", orderId).maybeSingle();
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    const { deliveredQty, invoicedQty } = await getOrderDeliveryAndInvoiceTotals(orderId);
    const remainingQty = deliveredQty - invoicedQty;
    res.status(200).json({
      success: true,
      data: {
        orderId,
        orderQty: order.qty,
        deliveredQty,
        invoicedQty,
        remainingQty,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching remaining invoiceable quantity: " + error.message });
  }
};
