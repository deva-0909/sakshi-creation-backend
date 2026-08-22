const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, deriveInitials } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");
const { notifyStaff } = require("../lib/notify");

const SELECT = `
  id, receiptNumber:receipt_number, amount, paymentDate:payment_date, mode, referenceNumber:reference_number, notes,
  createdAt:created_at,
  invoice:invoice_id(id, invoiceNumber:invoice_number, status, grandTotal:grand_total, amountPaid:amount_paid),
  party:party_id(id, partyName:party_name),
  companyName:company_name_id(id, companyName:company_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

// A receipt can only be posted against an invoice that's actually been
// issued (or already partly paid) -- posting against a still-Draft invoice
// (not yet sent to the customer) or a Cancelled/fully-Paid one makes no
// sense. An unallocated advance (no invoiceId) skips this check entirely.
const RECEIVABLE_INVOICE_STATUSES = ["Issued", "Partially Paid"];

exports.createReceipt = async (req, res) => {
  try {
    const { invoiceId, partyId, companyName, amount, paymentDate, mode, referenceNumber, notes } = req.body;
    if (!isValidId(partyId) || !isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid partyId or companyName" });
    }
    if (invoiceId && !isValidId(invoiceId)) {
      return res.status(400).json({ success: false, message: "Invalid invoiceId" });
    }

    const { data: party } = await supabase.from("parties").select("id").eq("id", partyId).eq("is_delete", false).maybeSingle();
    if (!party) {
      return res.status(404).json({ success: false, message: "Party not found" });
    }
    const { data: company } = await supabase.from("company_names").select("id, company_name").eq("id", companyName).maybeSingle();
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }

    let existingInvoice = null;
    if (invoiceId) {
      const { data: invoice } = await supabase
        .from("invoices")
        .select("id, status, grand_total, amount_paid, party_id, created_by, invoice_number")
        .eq("id", invoiceId)
        .eq("is_delete", false)
        .maybeSingle();
      if (!invoice) {
        return res.status(404).json({ success: false, message: "Invoice not found" });
      }
      if (!RECEIVABLE_INVOICE_STATUSES.includes(invoice.status)) {
        return res.status(400).json({ success: false, message: `Cannot record a receipt against an invoice in '${invoice.status}' status` });
      }
      if (String(invoice.party_id) !== String(partyId)) {
        return res.status(400).json({ success: false, message: "partyId does not match the invoice's billed party" });
      }
      const remaining = Number(invoice.grand_total) - Number(invoice.amount_paid);
      if (Number(amount) > remaining) {
        return res.status(400).json({ success: false, message: `Cannot receive ${amount} against an invoice with only ${remaining} outstanding` });
      }
      existingInvoice = invoice;
    }

    const initials = deriveInitials(company.company_name);

    const { data: receiptId, error } = await supabase.rpc("record_receipt_transactional", {
      p_invoice_id: invoiceId || null,
      p_party_id: partyId,
      p_company_name_id: companyName,
      p_amount: Number(amount),
      p_payment_date: paymentDate,
      p_mode: mode,
      p_reference_number: referenceNumber || null,
      p_notes: notes || null,
      p_created_by: req.user?.id || null,
      p_initials: initials,
    });
    if (error) throw error;

    const { data: populated } = await supabase.from("receipts").select(SELECT).eq("id", receiptId).single();
    logAudit({ req, action: "create", module: "receipt", recordId: receiptId, newValue: populated });

    // The invoice's status may have just been auto-updated to Partially
    // Paid/Paid inside record_receipt_transactional -- notify its creator
    // (never the amount-received flow itself, which has no approval gate).
    if (existingInvoice && populated?.invoice?.status && populated.invoice.status !== existingInvoice.status) {
      await notifyStaff({
        recipientIds: [existingInvoice.created_by],
        type: "invoice_status",
        title: `Invoice ${existingInvoice.invoice_number} -> ${populated.invoice.status}`,
        message: `Invoice ${existingInvoice.invoice_number} moved from ${existingInvoice.status} to ${populated.invoice.status} after receipt ${populated.receiptNumber}.`,
        entityType: "invoice",
        entityId: invoiceId,
        link: `/admin/accounting/invoices/view/${invoiceId}`,
      });
    }

    res.status(201).json({ success: true, message: "Receipt recorded successfully", data: withMongoId(populated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error recording receipt: " + error.message });
  }
};

// Module 9: post one receipt split across multiple invoices in a single
// transactional RPC call (record_receipt_allocation_transactional), instead
// of the caller looping createReceipt per invoice -- a partial failure
// partway through a loop would leave the payment half-applied.
const ALLOCATION_SELECT = `
  id, amountAllocated:amount_allocated,
  invoice:invoice_id(id, invoiceNumber:invoice_number, status, grandTotal:grand_total, amountPaid:amount_paid)
`;

exports.createReceiptAllocation = async (req, res) => {
  try {
    const { partyId, companyName, amount, paymentDate, mode, referenceNumber, notes, allocations } = req.body;
    if (!isValidId(partyId) || !isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid partyId or companyName" });
    }
    for (const a of allocations) {
      if (!isValidId(a.invoiceId)) {
        return res.status(400).json({ success: false, message: `Invalid invoiceId in allocations: ${a.invoiceId}` });
      }
    }
    const invoiceIds = allocations.map((a) => String(a.invoiceId));
    if (new Set(invoiceIds).size !== invoiceIds.length) {
      return res.status(400).json({ success: false, message: "Duplicate invoiceId in allocations -- combine into a single line" });
    }

    const { data: party } = await supabase.from("parties").select("id").eq("id", partyId).eq("is_delete", false).maybeSingle();
    if (!party) {
      return res.status(404).json({ success: false, message: "Party not found" });
    }
    const { data: company } = await supabase.from("company_names").select("id, company_name").eq("id", companyName).maybeSingle();
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }

    const { data: invoices, error: invErr } = await supabase
      .from("invoices")
      .select("id, status, grand_total, amount_paid, party_id, created_by, invoice_number")
      .in("id", invoiceIds)
      .eq("is_delete", false);
    if (invErr) throw invErr;
    if (!invoices || invoices.length !== invoiceIds.length) {
      return res.status(404).json({ success: false, message: "One or more invoices in the allocation were not found" });
    }

    const invoiceById = new Map(invoices.map((inv) => [String(inv.id), inv]));
    let allocatedTotal = 0;
    for (const a of allocations) {
      const invoice = invoiceById.get(String(a.invoiceId));
      if (!RECEIVABLE_INVOICE_STATUSES.includes(invoice.status)) {
        return res.status(400).json({ success: false, message: `Cannot allocate to invoice ${invoice.invoice_number} in '${invoice.status}' status` });
      }
      if (String(invoice.party_id) !== String(partyId)) {
        return res.status(400).json({ success: false, message: `Invoice ${invoice.invoice_number} does not belong to partyId` });
      }
      const remaining = Number(invoice.grand_total) - Number(invoice.amount_paid);
      if (Number(a.amount) > remaining) {
        return res.status(400).json({ success: false, message: `Cannot allocate ${a.amount} to invoice ${invoice.invoice_number} with only ${remaining} outstanding` });
      }
      allocatedTotal += Number(a.amount);
    }
    if (allocatedTotal > Number(amount)) {
      return res.status(400).json({ success: false, message: `Allocated total (${allocatedTotal}) exceeds receipt amount (${amount})` });
    }

    const initials = deriveInitials(company.company_name);

    const { data: receiptId, error } = await supabase.rpc("record_receipt_allocation_transactional", {
      p_party_id: partyId,
      p_company_name_id: companyName,
      p_amount: Number(amount),
      p_payment_date: paymentDate,
      p_mode: mode,
      p_reference_number: referenceNumber || null,
      p_notes: notes || null,
      p_created_by: req.user?.id || null,
      p_initials: initials,
      p_allocations: allocations.map((a) => ({ invoice_id: a.invoiceId, amount: Number(a.amount) })),
    });
    if (error) throw error;

    const { data: populated } = await supabase.from("receipts").select(SELECT).eq("id", receiptId).single();
    const { data: allocationRows } = await supabase.from("receipt_allocations").select(ALLOCATION_SELECT).eq("receipt_id", receiptId);
    logAudit({ req, action: "create", module: "receipt", recordId: receiptId, newValue: { ...populated, allocations: allocationRows } });

    for (const a of allocations) {
      const before = invoiceById.get(String(a.invoiceId));
      const after = (allocationRows || []).find((r) => String(r.invoice?.id) === String(a.invoiceId))?.invoice;
      if (after && after.status !== before.status) {
        await notifyStaff({
          recipientIds: [before.created_by],
          type: "invoice_status",
          title: `Invoice ${before.invoice_number} -> ${after.status}`,
          message: `Invoice ${before.invoice_number} moved from ${before.status} to ${after.status} after receipt ${populated.receiptNumber}.`,
          entityType: "invoice",
          entityId: before.id,
          link: `/admin/accounting/invoices/view/${before.id}`,
        });
      }
    }

    res.status(201).json({
      success: true,
      message: "Receipt recorded and allocated successfully",
      data: withMongoId({ ...populated, allocations: allocationRows }),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error recording allocated receipt: " + error.message });
  }
};

exports.getAllReceipts = async (req, res) => {
  try {
    const { invoiceId, partyId, search, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("receipts").select(SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (invoiceId) query = query.eq("invoice_id", invoiceId);
    if (partyId) query = query.eq("party_id", partyId);
    if (search && String(search).trim()) query = query.ilike("receipt_number", `%${String(search).trim()}%`);

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
    res.status(500).json({ success: false, message: "Error fetching receipts: " + error.message });
  }
};

exports.getReceiptById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid receipt ID" });
    }
    const { data, error } = await supabase.from("receipts").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Receipt not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching receipt: " + error.message });
  }
};
