// Module 11 Part B: Purchase Requisition -- Draft -> Pending Approval ->
// Approved -> Converted (to RFQ or PO), or Rejected/Cancelled along the
// way. Conversion reuses the existing create_rfq_transactional /
// create_purchase_order_transactional RPCs directly rather than
// duplicating their logic here -- a converted requisition just becomes the
// audit trail pointing at the RFQ/PO those RPCs already know how to build.
const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, deriveInitials } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

const SELECT = `
  id, requisitionNumber:requisition_number, status, notes, approvedAt:approved_at,
  createdAt:created_at, updatedAt:updated_at,
  convertedToRfqId:converted_to_rfq_id, convertedToPoId:converted_to_po_id,
  companyName:company_name_id(id, companyName:company_name),
  requestedBy:requested_by(id, firstName:first_name, lastName:last_name),
  approvedBy:approved_by(id, firstName:first_name, lastName:last_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

const ITEM_SELECT = `
  id, quantityRequired:quantity_required, notes,
  material:material_id(id, materialName:material_name, materialSize:material_size, materialGSM:material_gsm)
`;

const ALLOWED_TRANSITIONS = {
  Draft: ["Pending Approval", "Cancelled"],
  "Pending Approval": ["Approved", "Rejected", "Cancelled"],
  Approved: ["Cancelled"], // Converted is set only by convertToRfq/convertToPo below
};

async function recordHistory({ purchaseRequisitionId, fromStatus, toStatus, changedBy, remarks }) {
  const { error } = await supabase.from("purchase_requisition_status_history").insert({
    purchase_requisition_id: purchaseRequisitionId,
    from_status: fromStatus,
    to_status: toStatus,
    changed_by: changedBy || null,
    remarks: remarks || null,
  });
  if (error) console.error("Purchase requisition status history insert failed:", error.message);
}

async function transition(req, res, { toStatus, requireRemarksField, extraUpdate = {} } = {}) {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      res.status(400).json({ success: false, message: "Invalid purchase requisition ID" });
      return null;
    }
    const { data: pr } = await supabase.from("purchase_requisitions").select("id, status").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!pr) {
      res.status(404).json({ success: false, message: "Purchase requisition not found" });
      return null;
    }
    const allowed = ALLOWED_TRANSITIONS[pr.status] || [];
    if (!allowed.includes(toStatus)) {
      res.status(400).json({ success: false, message: `Cannot move a purchase requisition from '${pr.status}' to '${toStatus}'` });
      return null;
    }
    if (requireRemarksField && !req.body[requireRemarksField]) {
      res.status(400).json({ success: false, message: `${requireRemarksField} is required` });
      return null;
    }

    const updateData = { status: toStatus, updated_at: new Date().toISOString(), updated_by: req.user?.id || null, ...extraUpdate };
    const { data, error } = await supabase.from("purchase_requisitions").update(updateData).eq("id", id).select(SELECT).single();
    if (error) throw error;

    await recordHistory({
      purchaseRequisitionId: id,
      fromStatus: pr.status,
      toStatus,
      changedBy: req.user?.id,
      remarks: requireRemarksField ? req.body[requireRemarksField] : null,
    });
    logAudit({ req, action: "update", module: "purchaserequisition", recordId: id, newValue: data });
    return { data };
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating purchase requisition: " + error.message });
    return null;
  }
}

exports.createPurchaseRequisition = async (req, res) => {
  try {
    const { companyName, notes, items } = req.body;
    if (!isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid company ID" });
    }
    const { data: company } = await supabase.from("company_names").select("id, company_name").eq("id", companyName).maybeSingle();
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }
    const materialIds = items.map((i) => i.materialId);
    const { data: materials } = await supabase.from("materials").select("id").in("id", materialIds).eq("is_delete", false);
    if (!materials || materials.length !== new Set(materialIds).size) {
      return res.status(404).json({ success: false, message: "One or more materials were not found" });
    }

    const initials = deriveInitials(company.company_name);
    const { data: requisitionNumber, error: numErr } = await supabase.rpc("next_document_number", {
      p_doc_type: "purchase_requisition",
      p_initials: initials,
    });
    if (numErr) throw numErr;

    const { data: pr, error: prErr } = await supabase
      .from("purchase_requisitions")
      .insert({
        requisition_number: requisitionNumber,
        company_name_id: companyName,
        notes: notes || null,
        requested_by: req.user?.id || null,
        created_by: req.user?.id || null,
      })
      .select("id")
      .single();
    if (prErr) throw prErr;

    const { error: itemErr } = await supabase.from("purchase_requisition_items").insert(
      items.map((i) => ({
        purchase_requisition_id: pr.id,
        material_id: i.materialId,
        quantity_required: Number(i.quantityRequired),
        notes: i.notes || null,
      }))
    );
    if (itemErr) throw itemErr;

    await recordHistory({ purchaseRequisitionId: pr.id, fromStatus: null, toStatus: "Draft", changedBy: req.user?.id });

    const { data: populated } = await supabase.from("purchase_requisitions").select(SELECT).eq("id", pr.id).single();
    const { data: prItems } = await supabase.from("purchase_requisition_items").select(ITEM_SELECT).eq("purchase_requisition_id", pr.id);

    logAudit({ req, action: "create", module: "purchaserequisition", recordId: pr.id, newValue: populated });
    res.status(201).json({ success: true, message: "Purchase requisition created successfully", data: withMongoId({ ...populated, items: prItems || [] }) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating purchase requisition: " + error.message });
  }
};

exports.getAllPurchaseRequisitions = async (req, res) => {
  try {
    const { status, companyName, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;
    let query = supabase.from("purchase_requisitions").select(SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    if (companyName) query = query.eq("company_name_id", companyName);

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
    res.status(500).json({ success: false, message: "Error fetching purchase requisitions: " + error.message });
  }
};

exports.getPurchaseRequisitionById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid purchase requisition ID" });
    }
    const { data, error } = await supabase.from("purchase_requisitions").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Purchase requisition not found" });
    }
    const { data: items } = await supabase.from("purchase_requisition_items").select(ITEM_SELECT).eq("purchase_requisition_id", id);
    res.status(200).json({ success: true, data: withMongoId({ ...data, items: items || [] }) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching purchase requisition: " + error.message });
  }
};

exports.deletePurchaseRequisition = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid purchase requisition ID" });
    }
    const { data: pr } = await supabase.from("purchase_requisitions").select("id, status").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!pr) {
      return res.status(404).json({ success: false, message: "Purchase requisition not found" });
    }
    if (pr.status !== "Draft") {
      return res.status(400).json({ success: false, message: "Only a Draft purchase requisition can be deleted" });
    }
    const { error } = await supabase.from("purchase_requisitions").update({ is_delete: true }).eq("id", id);
    if (error) throw error;
    logAudit({ req, action: "delete", module: "purchaserequisition", recordId: id });
    res.status(200).json({ success: true, message: "Purchase requisition deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting purchase requisition: " + error.message });
  }
};

exports.submitForApproval = async (req, res) => {
  const result = await transition(req, res, { toStatus: "Pending Approval" });
  if (result) res.status(200).json({ success: true, message: "Purchase requisition submitted for approval", data: withMongoId(result.data) });
};

exports.approvePurchaseRequisition = async (req, res) => {
  const result = await transition(req, res, { toStatus: "Approved", extraUpdate: { approved_by: req.user?.id || null, approved_at: new Date().toISOString() } });
  if (result) res.status(200).json({ success: true, message: "Purchase requisition approved", data: withMongoId(result.data) });
};

exports.rejectPurchaseRequisition = async (req, res) => {
  const result = await transition(req, res, { toStatus: "Rejected", requireRemarksField: "remarks" });
  if (result) res.status(200).json({ success: true, message: "Purchase requisition rejected", data: withMongoId(result.data) });
};

exports.cancelPurchaseRequisition = async (req, res) => {
  const result = await transition(req, res, { toStatus: "Cancelled", requireRemarksField: "remarks" });
  if (result) res.status(200).json({ success: true, message: "Purchase requisition cancelled", data: withMongoId(result.data) });
};

exports.getPurchaseRequisitionHistory = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid purchase requisition ID" });
    }
    const { data, error } = await supabase
      .from("purchase_requisition_status_history")
      .select("id, fromStatus:from_status, toStatus:to_status, remarks, createdAt:created_at, changedBy:changed_by(id, firstName:first_name, lastName:last_name)")
      .eq("purchase_requisition_id", id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching purchase requisition history: " + error.message });
  }
};

// Approved -> Converted, spawns a new RFQ from this requisition's own
// material lines (quantityRequired -> quantityNeeded).
//
// Module 16 fix (audit-reconciliation.md's carried-forward non-atomic
// conversion-pattern finding): this used to check status in JS, call
// create_rfq_transactional, then separately update
// purchase_requisitions.status to Converted -- a failure between those two
// steps (or two concurrent conversions of the same requisition) could
// leave an RFQ created with the requisition still Approved, convertible
// again into a duplicate RFQ. convert_purchase_requisition_to_rfq_
// transactional locks the requisition row, re-checks status under that
// lock, creates the RFQ, and updates the requisition's status/
// converted_to_rfq_id all in one transaction. Vendor-existence and
// items-non-empty validation stay here in JS beforehand -- input
// validation, not the atomicity concern the audit flagged.
exports.convertToRfq = async (req, res) => {
  try {
    const { id } = req.params;
    const { vendorIds, notes } = req.body;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid purchase requisition ID" });
    }
    const { data: pr } = await supabase.from("purchase_requisitions").select("id, status, companyRow:company_name_id(company_name)").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!pr) {
      return res.status(404).json({ success: false, message: "Purchase requisition not found" });
    }
    const { data: vendors } = await supabase.from("vendors").select("id").in("id", vendorIds).eq("is_delete", false);
    if (!vendors || vendors.length !== new Set(vendorIds).size) {
      return res.status(404).json({ success: false, message: "One or more vendors were not found" });
    }
    const { data: items } = await supabase.from("purchase_requisition_items").select("material_id, quantity_required").eq("purchase_requisition_id", id);
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: "This purchase requisition has no items" });
    }

    const initials = deriveInitials(pr.companyRow?.company_name);
    const { data: rfqId, error } = await supabase.rpc("convert_purchase_requisition_to_rfq_transactional", {
      p_requisition_id: id,
      p_notes: notes || `Converted from Purchase Requisition ${id}`,
      p_created_by: req.user?.id || null,
      p_initials: initials,
      p_items: items.map((i) => ({ materialId: i.material_id, quantityNeeded: Number(i.quantity_required) })),
      p_vendor_ids: vendorIds,
    });
    if (error) {
      if (error.message && error.message.includes("Only an Approved purchase requisition")) {
        return res.status(400).json({ success: false, message: error.message });
      }
      throw error;
    }

    const { data, error: fetchErr } = await supabase.from("purchase_requisitions").select(SELECT).eq("id", id).single();
    if (fetchErr) throw fetchErr;

    await recordHistory({ purchaseRequisitionId: id, fromStatus: "Approved", toStatus: "Converted", changedBy: req.user?.id, remarks: `Converted to RFQ ${rfqId}` });
    logAudit({ req, action: "update", module: "purchaserequisition", recordId: id, newValue: data });

    res.status(200).json({ success: true, message: "Purchase requisition converted to RFQ", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error converting purchase requisition to RFQ: " + error.message });
  }
};

// Approved -> Converted, spawns a new Draft PO directly (skipping RFQ) --
// the requisitioner already knows which vendor and at what rate.
//
// Module 16 fix (same as convertToRfq above): status check + create + status
// update are now one atomic transaction (convert_purchase_requisition_to_
// po_transactional), closing the same duplicate-PO/stuck-status race.
// Vendor-existence, items-non-empty, and rate-required validation stay
// here in JS beforehand -- input validation, not the atomicity concern.
exports.convertToPo = async (req, res) => {
  try {
    const { id } = req.params;
    const { vendorId, expectedDate, notes, items: rateItems } = req.body;
    if (!isValidId(id) || !isValidId(vendorId)) {
      return res.status(400).json({ success: false, message: "Invalid purchase requisition ID or vendor ID" });
    }
    const { data: pr } = await supabase.from("purchase_requisitions").select("id, status").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!pr) {
      return res.status(404).json({ success: false, message: "Purchase requisition not found" });
    }
    const { data: vendor } = await supabase.from("vendors").select("id").eq("id", vendorId).eq("is_delete", false).maybeSingle();
    if (!vendor) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }
    const { data: items } = await supabase.from("purchase_requisition_items").select("id, material_id, quantity_required").eq("purchase_requisition_id", id);
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: "This purchase requisition has no items" });
    }
    const rateByItemId = Object.fromEntries(rateItems.map((r) => [String(r.requisitionItemId), Number(r.rate)]));
    for (const item of items) {
      if (rateByItemId[String(item.id)] === undefined) {
        return res.status(400).json({ success: false, message: `A rate is required for every requisition line (missing for item ${item.id})` });
      }
    }

    const { data: prForInitials } = await supabase.from("purchase_requisitions").select("companyRow:company_name_id(company_name)").eq("id", id).maybeSingle();
    const initials = deriveInitials(prForInitials?.companyRow?.company_name);
    const { data: poId, error } = await supabase.rpc("convert_purchase_requisition_to_po_transactional", {
      p_requisition_id: id,
      p_vendor_id: vendorId,
      p_expected_date: expectedDate || null,
      p_notes: notes || `Converted from Purchase Requisition ${id}`,
      p_created_by: req.user?.id || null,
      p_initials: initials,
      p_items: items.map((i) => ({ materialId: i.material_id, quantityOrdered: Number(i.quantity_required), rate: rateByItemId[String(i.id)] })),
    });
    if (error) {
      if (error.message && error.message.includes("Only an Approved purchase requisition")) {
        return res.status(400).json({ success: false, message: error.message });
      }
      throw error;
    }

    const { data, error: fetchErr } = await supabase.from("purchase_requisitions").select(SELECT).eq("id", id).single();
    if (fetchErr) throw fetchErr;

    await recordHistory({ purchaseRequisitionId: id, fromStatus: "Approved", toStatus: "Converted", changedBy: req.user?.id, remarks: `Converted to PO ${poId}` });
    logAudit({ req, action: "update", module: "purchaserequisition", recordId: id, newValue: data });

    res.status(200).json({ success: true, message: "Purchase requisition converted to purchase order", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error converting purchase requisition to purchase order: " + error.message });
  }
};
