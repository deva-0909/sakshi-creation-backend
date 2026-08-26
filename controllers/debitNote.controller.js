// Module 9: debit notes reduce what we owe a vendor. Purchase orders have no
// amount_paid/status field to write back to (confirmed during research --
// see vendor_payment's own RPC, which never touches purchase_orders), so
// unlike credit notes, issuing a debit note is a plain status flip: no RPC
// needed. The vendor ledger query (Section 3 of the design plan) includes
// Issued debit notes as a credit line against the vendor's outstanding
// balance.
const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, deriveInitials } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

const SELECT = `
  id, debitNoteNumber:debit_note_number, amount, reason, status,
  createdAt:created_at, issuedAt:issued_at,
  vendor:vendor_id(id, name),
  purchaseOrder:purchase_order_id(id, poNumber:po_number, status),
  companyName:company_name_id(id, companyName:company_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

exports.createDebitNote = async (req, res) => {
  try {
    const { vendorId, purchaseOrderId, companyName, amount, reason } = req.body;
    if (!isValidId(vendorId) || !isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid vendorId or companyName" });
    }
    if (purchaseOrderId && !isValidId(purchaseOrderId)) {
      return res.status(400).json({ success: false, message: "Invalid purchaseOrderId" });
    }

    const { data: vendor } = await supabase.from("vendors").select("id").eq("id", vendorId).eq("is_delete", false).maybeSingle();
    if (!vendor) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }
    const { data: company } = await supabase.from("company_names").select("id, company_name").eq("id", companyName).maybeSingle();
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }
    if (purchaseOrderId) {
      const { data: po } = await supabase.from("purchase_orders").select("id, vendor_id").eq("id", purchaseOrderId).eq("is_delete", false).maybeSingle();
      if (!po) {
        return res.status(404).json({ success: false, message: "Purchase order not found" });
      }
      if (String(po.vendor_id) !== String(vendorId)) {
        return res.status(400).json({ success: false, message: "vendorId does not match the purchase order's vendor" });
      }
    }

    const initials = deriveInitials(company.company_name);
    // Module 10: numbering format now lives in numbering_configs.
    const { data: debitNoteNumber, error: numErr } = await supabase.rpc("next_document_number", {
      p_doc_type: "debit_note",
      p_initials: initials,
    });
    if (numErr) throw numErr;

    const { data: created, error } = await supabase
      .from("debit_notes")
      .insert({
        debit_note_number: debitNoteNumber,
        vendor_id: vendorId,
        purchase_order_id: purchaseOrderId || null,
        company_name_id: companyName,
        amount: Number(amount),
        reason: reason || null,
        status: "Draft",
        created_by: req.user?.id || null,
      })
      .select(SELECT)
      .single();
    if (error) throw error;

    logAudit({ req, action: "create", module: "debitnote", recordId: created.id, newValue: created });
    res.status(201).json({ success: true, message: "Debit note created as Draft", data: withMongoId(created) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating debit note: " + error.message });
  }
};

exports.issueDebitNote = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid debit note ID" });
    }
    const { data: before } = await supabase.from("debit_notes").select("id, status").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!before) {
      return res.status(404).json({ success: false, message: "Debit note not found" });
    }
    if (before.status !== "Draft") {
      return res.status(400).json({ success: false, message: `Only a Draft debit note can be issued (current status: ${before.status})` });
    }
    const { data: updated, error } = await supabase
      .from("debit_notes")
      .update({ status: "Issued", issued_at: new Date().toISOString() })
      .eq("id", id)
      .select(SELECT)
      .single();
    if (error) throw error;
    logAudit({ req, action: "update", module: "debitnote", recordId: id, oldValue: before, newValue: updated });
    res.status(200).json({ success: true, message: "Debit note issued", data: withMongoId(updated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error issuing debit note: " + error.message });
  }
};

exports.cancelDebitNote = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid debit note ID" });
    }
    const { data: before } = await supabase.from("debit_notes").select("id, status").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!before) {
      return res.status(404).json({ success: false, message: "Debit note not found" });
    }
    if (before.status !== "Draft") {
      return res.status(400).json({ success: false, message: "Only a Draft debit note can be cancelled -- an Issued one has already reduced the vendor's balance" });
    }
    const { data: updated, error } = await supabase.from("debit_notes").update({ status: "Cancelled" }).eq("id", id).select(SELECT).single();
    if (error) throw error;
    logAudit({ req, action: "update", module: "debitnote", recordId: id, oldValue: before, newValue: updated });
    res.status(200).json({ success: true, message: "Debit note cancelled", data: withMongoId(updated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error cancelling debit note: " + error.message });
  }
};

exports.getAllDebitNotes = async (req, res) => {
  try {
    const { vendorId, purchaseOrderId, status, search, page, limit, companyName } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("debit_notes").select(SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (vendorId) query = query.eq("vendor_id", vendorId);
    if (purchaseOrderId) query = query.eq("purchase_order_id", purchaseOrderId);
    if (status) query = query.eq("status", status);
    // Mobile/toggle/seed audit (2026-08-26), Phase C: companyName param
    // added -- previously always mixed both companies' debit notes.
    if (companyName) query = query.eq("company_name_id", companyName);
    if (search && String(search).trim()) query = query.ilike("debit_note_number", `%${String(search).trim()}%`);
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
      response.pagination = { currentPage: pageNum, totalPages: Math.ceil(count / limitNum), totalCount: count, hasNext: from + data.length < count, hasPrev: pageNum > 1 };
    }
    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching debit notes: " + error.message });
  }
};

exports.getDebitNoteById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid debit note ID" });
    }
    const { data, error } = await supabase.from("debit_notes").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Debit note not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching debit note: " + error.message });
  }
};
