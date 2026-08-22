// Module 9: credit notes reduce what a customer owes against one invoice.
// Draft -> Issued -> Cancelled, same lifecycle shape as invoices/POs. Issuing
// is the only transition with a side effect (applies to the invoice via
// issue_credit_note_transactional); Draft->Cancelled is a plain status flip
// with no financial effect since nothing was ever applied yet.
const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, deriveInitials } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");
const { notifyStaff } = require("../lib/notify");

const SELECT = `
  id, creditNoteNumber:credit_note_number, amount, reason, status,
  createdAt:created_at, issuedAt:issued_at,
  invoice:invoice_id(id, invoiceNumber:invoice_number, status, grandTotal:grand_total, amountPaid:amount_paid),
  party:party_id(id, partyName:party_name),
  companyName:company_name_id(id, companyName:company_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

exports.createCreditNote = async (req, res) => {
  try {
    const { invoiceId, amount, reason } = req.body;
    if (!isValidId(invoiceId)) {
      return res.status(400).json({ success: false, message: "Invalid invoiceId" });
    }

    const { data: invoice } = await supabase
      .from("invoices")
      .select("id, status, grand_total, amount_paid, party_id, company_name_id, invoice_number")
      .eq("id", invoiceId)
      .eq("is_delete", false)
      .maybeSingle();
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    if (!["Issued", "Partially Paid", "Paid"].includes(invoice.status)) {
      return res.status(400).json({ success: false, message: `Cannot raise a credit note against an invoice in '${invoice.status}' status` });
    }
    const remaining = Number(invoice.grand_total) - Number(invoice.amount_paid);
    if (Number(amount) > remaining) {
      return res.status(400).json({ success: false, message: `Cannot credit ${amount} against an invoice with only ${remaining} outstanding` });
    }

    const { data: company } = await supabase.from("company_names").select("id, company_name").eq("id", invoice.company_name_id).maybeSingle();
    const initials = deriveInitials(company?.company_name);

    // Module 10: numbering format (prefix/padding/offset) now lives in the
    // numbering_configs table -- next_document_number() reads it instead of
    // this controller building the string by hand.
    const { data: creditNoteNumber, error: numErr } = await supabase.rpc("next_document_number", {
      p_doc_type: "credit_note",
      p_initials: initials,
    });
    if (numErr) throw numErr;

    const { data: created, error } = await supabase
      .from("credit_notes")
      .insert({
        credit_note_number: creditNoteNumber,
        invoice_id: invoiceId,
        party_id: invoice.party_id,
        company_name_id: invoice.company_name_id,
        amount: Number(amount),
        reason: reason || null,
        status: "Draft",
        created_by: req.user?.id || null,
      })
      .select(SELECT)
      .single();
    if (error) throw error;

    logAudit({ req, action: "create", module: "creditnote", recordId: created.id, newValue: created });
    res.status(201).json({ success: true, message: "Credit note created as Draft", data: withMongoId(created) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating credit note: " + error.message });
  }
};

exports.issueCreditNote = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid credit note ID" });
    }

    const { data: before } = await supabase
      .from("credit_notes")
      .select("id, status, invoice_id, credit_note_number")
      .eq("id", id)
      .eq("is_delete", false)
      .maybeSingle();
    if (!before) {
      return res.status(404).json({ success: false, message: "Credit note not found" });
    }
    if (before.status !== "Draft") {
      return res.status(400).json({ success: false, message: `Only a Draft credit note can be issued (current status: ${before.status})` });
    }

    const { data: invoiceBefore } = await supabase.from("invoices").select("status, invoice_number, created_by").eq("id", before.invoice_id).maybeSingle();

    const { error } = await supabase.rpc("issue_credit_note_transactional", {
      p_credit_note_id: id,
      p_issued_by: req.user?.id || null,
    });
    if (error) throw error;

    const { data: populated } = await supabase.from("credit_notes").select(SELECT).eq("id", id).single();
    logAudit({ req, action: "update", module: "creditnote", recordId: id, oldValue: before, newValue: populated });

    if (invoiceBefore && populated?.invoice?.status && populated.invoice.status !== invoiceBefore.status) {
      await notifyStaff({
        recipientIds: [invoiceBefore.created_by],
        type: "invoice_status",
        title: `Invoice ${invoiceBefore.invoice_number} -> ${populated.invoice.status}`,
        message: `Invoice ${invoiceBefore.invoice_number} moved from ${invoiceBefore.status} to ${populated.invoice.status} after credit note ${populated.creditNoteNumber}.`,
        entityType: "invoice",
        entityId: before.invoice_id,
        link: `/admin/accounting/invoices/view/${before.invoice_id}`,
      });
    }

    res.status(200).json({ success: true, message: "Credit note issued and applied to invoice", data: withMongoId(populated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error issuing credit note: " + error.message });
  }
};

exports.cancelCreditNote = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid credit note ID" });
    }
    const { data: before } = await supabase.from("credit_notes").select("id, status").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!before) {
      return res.status(404).json({ success: false, message: "Credit note not found" });
    }
    if (before.status !== "Draft") {
      return res.status(400).json({ success: false, message: "Only a Draft credit note can be cancelled -- an Issued one has already been applied to the invoice" });
    }
    const { data: updated, error } = await supabase.from("credit_notes").update({ status: "Cancelled" }).eq("id", id).select(SELECT).single();
    if (error) throw error;
    logAudit({ req, action: "update", module: "creditnote", recordId: id, oldValue: before, newValue: updated });
    res.status(200).json({ success: true, message: "Credit note cancelled", data: withMongoId(updated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error cancelling credit note: " + error.message });
  }
};

exports.getAllCreditNotes = async (req, res) => {
  try {
    const { invoiceId, partyId, status, search, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("credit_notes").select(SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (invoiceId) query = query.eq("invoice_id", invoiceId);
    if (partyId) query = query.eq("party_id", partyId);
    if (status) query = query.eq("status", status);
    if (search && String(search).trim()) query = query.ilike("credit_note_number", `%${String(search).trim()}%`);

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
      response.pagination = { currentPage: pageNum, totalPages: Math.ceil(count / limitNum), totalCount: count, hasNext: from + data.length < count, hasPrev: pageNum > 1 };
    }
    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching credit notes: " + error.message });
  }
};

exports.getCreditNoteById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid credit note ID" });
    }
    const { data, error } = await supabase.from("credit_notes").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Credit note not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching credit note: " + error.message });
  }
};
