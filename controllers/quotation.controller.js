const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, deriveInitials } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");
const { notifyStatusChange } = require("../lib/notify");
const { buildQuotationPdf, streamPdf } = require("../lib/pdf");

const SELECT = `
  id, quotationNumber:quotation_number, qty, size, specs, rateType:rate_type, rate, printingrate,
  isGst:is_gst, gstPercentage:gst_percentage, totalAmount:total_amount, status, validUntil:valid_until,
  approvedAt:approved_at, sentAt:sent_at, respondedAt:responded_at, remarks, orderId:order_id,
  createdAt:created_at, updatedAt:updated_at,
  companyName:company_name_id(id, companyName:company_name),
  party:party_id(id, partyName:party_name),
  productItem:product_item_id(id, itemName:item_name),
  approvedBy:approved_by(id, firstName:first_name, lastName:last_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

// Transitions this module actually allows, keyed by current status. Kept
// as one map so every status-changing endpoint checks against the same
// source of truth rather than duplicating the flow.
const ALLOWED_TRANSITIONS = {
  Draft: ["Pending Approval"],
  "Pending Approval": ["Approved", "Rejected"],
  Approved: ["Sent"],
  Sent: ["Accepted", "Rejected"],
  Accepted: ["Converted"],
};

async function recordHistory({ quotationId, fromStatus, toStatus, changedBy, remarks }) {
  const { error } = await supabase.from("quotation_status_history").insert({
    quotation_id: quotationId,
    from_status: fromStatus,
    to_status: toStatus,
    changed_by: changedBy || null,
    remarks: remarks || null,
  });
  if (error) console.error("Quotation status history insert failed:", error.message);
}

async function transition(req, res, { toStatus, requireRemarksField, extraUpdate = {}, extraGuard } = {}) {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid quotation ID" });
    }
    const { data: quotation } = await supabase.from("quotations").select("id, status, created_by").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!quotation) {
      return res.status(404).json({ success: false, message: "Quotation not found" });
    }
    const allowed = ALLOWED_TRANSITIONS[quotation.status] || [];
    if (!allowed.includes(toStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot move a quotation from '${quotation.status}' to '${toStatus}'`,
      });
    }
    if (extraGuard) {
      const guardError = extraGuard(req);
      if (guardError) return res.status(400).json({ success: false, message: guardError });
    }
    if (requireRemarksField && !req.body[requireRemarksField]) {
      return res.status(400).json({ success: false, message: `${requireRemarksField} is required` });
    }

    const updateData = {
      status: toStatus,
      updated_by: req.user?.id || null,
      updated_at: new Date().toISOString(),
      ...extraUpdate,
    };
    const { data, error } = await supabase.from("quotations").update(updateData).eq("id", id).select(SELECT).single();
    if (error) throw error;

    await recordHistory({
      quotationId: id,
      fromStatus: quotation.status,
      toStatus,
      changedBy: req.user?.id || null,
      remarks: requireRemarksField ? req.body[requireRemarksField] : req.body.remarks,
    });

    logAudit({ req, action: "update", module: "quotation", recordId: id, newValue: { status: toStatus } });

    await notifyStatusChange({
      moduleKey: "quotation",
      entityType: "quotation",
      entityId: id,
      creatorId: quotation.created_by,
      actorId: req.user?.id || null,
      toStatus,
      title: `Quotation ${data.quotationNumber} -> ${toStatus}`,
      message: `Quotation ${data.quotationNumber} moved from ${quotation.status} to ${toStatus}.`,
      link: `/admin/quotation/view/${id}`,
    });

    return { data };
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating quotation status: " + error.message });
    return null;
  }
}

exports.createQuotation = async (req, res) => {
  try {
    const { companyName, party, productItem, qty, size, specs, rateType, rate, printingrate, isGst, gstPercentage, totalAmount, validUntil, remarks } = req.body;
    if (!isValidId(companyName) || !isValidId(party) || !isValidId(productItem)) {
      return res.status(400).json({ success: false, message: "Invalid ID format for companyName, party, or productItem" });
    }

    const { data: company } = await supabase.from("company_names").select("id, company_name").eq("id", companyName).maybeSingle();
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }
    const { data: partyRow } = await supabase.from("parties").select("id").eq("id", party).eq("is_delete", false).maybeSingle();
    if (!partyRow) {
      return res.status(404).json({ success: false, message: "Party not found" });
    }
    const { data: productItemRow } = await supabase.from("product_items").select("id").eq("id", productItem).eq("is_delete", false).maybeSingle();
    if (!productItemRow) {
      return res.status(404).json({ success: false, message: "Product item not found" });
    }

    const initials = deriveInitials(company.company_name);

    const { data: quotationId, error } = await supabase.rpc("create_quotation_transactional", {
      p_company_name_id: companyName,
      p_party_id: party,
      p_product_item_id: productItem,
      p_qty: parseInt(qty, 10),
      p_size: size || null,
      p_specs: specs || {},
      p_rate_type: rateType || null,
      p_rate: rate !== undefined ? parseFloat(rate) : null,
      p_printingrate: printingrate !== undefined ? parseFloat(printingrate) : null,
      p_is_gst: isGst !== false,
      p_gst_percentage: gstPercentage !== undefined ? parseFloat(gstPercentage) : null,
      p_total_amount: totalAmount !== undefined ? parseFloat(totalAmount) : null,
      p_valid_until: validUntil || null,
      p_remarks: remarks || null,
      p_created_by: req.user?.id || null,
      p_initials: initials,
    });
    if (error) throw error;

    const { data: populated } = await supabase.from("quotations").select(SELECT).eq("id", quotationId).single();

    logAudit({ req, action: "create", module: "quotation", recordId: quotationId, newValue: populated });

    res.status(201).json({ success: true, message: "Quotation created successfully", data: withMongoId(populated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating quotation: " + error.message });
  }
};

exports.getAllQuotations = async (req, res) => {
  try {
    const { status, search, page, limit, partyId } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("quotations").select(SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    // Module 15: powers the party 360 view's quotation history panel --
    // this filter didn't exist before even though quotations.party_id
    // always has (orders/invoices/receipts/opportunities already support
    // the equivalent party-scoping param).
    if (partyId) query = query.eq("party_id", partyId);
    if (search && String(search).trim()) {
      query = query.ilike("quotation_number", `%${String(search).trim()}%`);
    }

    let pageNum, limitNum, from;
    if (paginate) {
      pageNum = parseInt(page, 10) || 1;
      limitNum = parseInt(limit, 10) || 10;
      from = (pageNum - 1) * limitNum;
      const to = from + limitNum - 1;
      query = query.range(from, to);
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
    res.status(500).json({ success: false, message: "Error fetching quotations: " + error.message });
  }
};

exports.getQuotationById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid quotation ID" });
    }
    const { data, error } = await supabase.from("quotations").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Quotation not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching quotation: " + error.message });
  }
};

exports.getQuotationPdf = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid quotation ID" });
    }
    const { data: quotation, error } = await supabase.from("quotations").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!quotation) {
      return res.status(404).json({ success: false, message: "Quotation not found" });
    }
    const doc = await buildQuotationPdf(quotation);
    streamPdf(res, doc, `${quotation.quotationNumber}.pdf`);
  } catch (error) {
    res.status(500).json({ success: false, message: "Error generating quotation PDF: " + error.message });
  }
};

exports.updateQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid quotation ID" });
    }
    const { data: existing } = await supabase.from("quotations").select("id, status").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!existing) {
      return res.status(404).json({ success: false, message: "Quotation not found" });
    }
    if (existing.status !== "Draft") {
      return res.status(400).json({ success: false, message: "Only a Draft quotation can be edited" });
    }

    const { companyName, party, productItem, qty, size, specs, rateType, rate, printingrate, isGst, gstPercentage, totalAmount, validUntil, remarks } = req.body;
    const updateData = {
      ...(companyName && { company_name_id: companyName }),
      ...(party && { party_id: party }),
      ...(productItem && { product_item_id: productItem }),
      ...(qty !== undefined && { qty: parseInt(qty, 10) }),
      ...(size !== undefined && { size }),
      ...(specs !== undefined && { specs }),
      ...(rateType !== undefined && { rate_type: rateType }),
      ...(rate !== undefined && { rate: parseFloat(rate) }),
      ...(printingrate !== undefined && { printingrate: parseFloat(printingrate) }),
      ...(isGst !== undefined && { is_gst: isGst }),
      ...(gstPercentage !== undefined && { gst_percentage: parseFloat(gstPercentage) }),
      ...(totalAmount !== undefined && { total_amount: parseFloat(totalAmount) }),
      ...(validUntil !== undefined && { valid_until: validUntil }),
      ...(remarks !== undefined && { remarks }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };

    const { data, error } = await supabase.from("quotations").update(updateData).eq("id", id).select(SELECT).single();
    if (error) throw error;

    logAudit({ req, action: "update", module: "quotation", recordId: id, newValue: data });

    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating quotation: " + error.message });
  }
};

exports.deleteQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid quotation ID" });
    }
    const { data, error } = await supabase.from("quotations").update({ is_delete: true }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Quotation not found" });
    }
    logAudit({ req, action: "delete", module: "quotation", recordId: id });
    res.status(200).json({ success: true, message: "Quotation deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting quotation: " + error.message });
  }
};

exports.submitForApproval = async (req, res) => {
  const result = await transition(req, res, { toStatus: "Pending Approval" });
  if (result) res.status(200).json({ success: true, message: "Quotation submitted for approval", data: withMongoId(result.data) });
};

exports.approveQuotation = async (req, res) => {
  const result = await transition(req, res, {
    toStatus: "Approved",
    extraUpdate: { approved_by: req.user?.id || null, approved_at: new Date().toISOString() },
  });
  if (result) res.status(200).json({ success: true, message: "Quotation approved", data: withMongoId(result.data) });
};

exports.rejectQuotation = async (req, res) => {
  const result = await transition(req, res, { toStatus: "Rejected", requireRemarksField: "remarks" });
  if (result) res.status(200).json({ success: true, message: "Quotation rejected", data: withMongoId(result.data) });
};

exports.sendQuotation = async (req, res) => {
  const result = await transition(req, res, { toStatus: "Sent", extraUpdate: { sent_at: new Date().toISOString() } });
  if (result) res.status(200).json({ success: true, message: "Quotation sent", data: withMongoId(result.data) });
};

exports.respondQuotation = async (req, res) => {
  const { response } = req.body;
  const result = await transition(req, res, {
    toStatus: response,
    extraUpdate: { responded_at: new Date().toISOString() },
  });
  if (result) res.status(200).json({ success: true, message: `Quotation marked ${response}`, data: withMongoId(result.data) });
};

// Module 16 fix (audit-reconciliation.md's carried-forward non-atomic
// conversion-pattern finding, user approved wrapping all three flagged
// conversions in dedicated RPCs): this used to check status in JS, call
// create_order_transactional, then separately update quotations.status to
// Converted -- a failure between those two steps (or two concurrent
// conversions of the same quotation) could leave an order created with
// the quotation still showing Accepted, convertible again into a
// duplicate order. convert_quotation_transactional locks the quotation
// row, re-checks status under that lock, creates the order, and updates
// the quotation's status all in one transaction.
//
// Fixing this also surfaced and fixed an unrelated, pre-existing bug:
// create_order_transactional has 3 overloads (14/16/17 params, added
// incrementally as order.controller.js's createOrder gained fields), and
// this endpoint's old call only ever supplied the original 14 -- which
// live-testing this fix showed Postgres treats as a genuinely ambiguous
// call ("function ... is not unique"), not a call to the 14-param
// overload as intended. order.controller.js's own createOrder was
// unaffected (it always supplies all 17 params, pinning the call
// unambiguously), but every attempt to convert a quotation to an order
// through this endpoint alone would have hit that error. The new RPC
// calls create_order_transactional with all 17 named params explicitly
// (the 3 newest passed null, matching what a quotation conversion has
// always populated), which is both atomic and unambiguous.
exports.convertQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid quotation ID" });
    }
    const { data: quotation } = await supabase.from("quotations").select("id, company_name_id, status").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!quotation) {
      return res.status(404).json({ success: false, message: "Quotation not found" });
    }

    const { data: company } = await supabase.from("company_names").select("company_name").eq("id", quotation.company_name_id).maybeSingle();
    const initials = deriveInitials(company?.company_name);

    const { data: orderId, error } = await supabase.rpc("convert_quotation_transactional", {
      p_quotation_id: id,
      p_initials: initials,
      p_updated_by: req.user?.id || null,
    });
    if (error) {
      // The RPC's own status guard raises a plain Postgres exception, not a
      // distinct error code -- match by message so the client still gets
      // the same 400 it got from the old JS-side check.
      if (error.message && error.message.includes("Only an Accepted quotation")) {
        return res.status(400).json({ success: false, message: error.message });
      }
      throw error;
    }

    const { data, error: fetchError } = await supabase.from("quotations").select(SELECT).eq("id", id).single();
    if (fetchError) throw fetchError;

    await recordHistory({ quotationId: id, fromStatus: "Accepted", toStatus: "Converted", changedBy: req.user?.id || null });
    logAudit({ req, action: "update", module: "quotation", recordId: id, newValue: { status: "Converted", orderId } });

    res.status(200).json({ success: true, message: "Quotation converted to order", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error converting quotation: " + error.message });
  }
};

exports.getQuotationHistory = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid quotation ID" });
    }
    const { data, error } = await supabase
      .from("quotation_status_history")
      .select("id, fromStatus:from_status, toStatus:to_status, remarks, createdAt:created_at, changedBy:changed_by(id, firstName:first_name, lastName:last_name)")
      .eq("quotation_id", id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching quotation history: " + error.message });
  }
};
