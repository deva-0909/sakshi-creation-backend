const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, deriveInitials } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");
const { notifyStatusChange } = require("../lib/notify");

const SELECT = `
  id, poNumber:po_number, status, expectedDate:expected_date, notes,
  approvedAt:approved_at, sentAt:sent_at, createdAt:created_at, updatedAt:updated_at,
  acknowledgedAt:acknowledged_at,
  rfqId:rfq_id,
  vendor:vendor_id(id, name),
  companyName:company_name_id(id, companyName:company_name),
  approvedBy:approved_by(id, firstName:first_name, lastName:last_name),
  acknowledgedBy:acknowledged_by(id, firstName:first_name, lastName:last_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

// PO acknowledgement (Module 11 Part B) isn't part of the transition map --
// "Sent" stays the terminal user-driven status; this is orthogonal
// vendor-facing metadata that can be set any time after the PO went out.
const ACKNOWLEDGEABLE_PO_STATUSES = ["Sent", "Partially Received", "Received"];

const ITEM_SELECT = `
  id, quantityOrdered:quantity_ordered, rate, quantityReceived:quantity_received,
  material:material_id(id, materialName:material_name, materialSize:material_size, materialGSM:material_gsm)
`;

// Only Draft/Pending Approval/Approved/Sent are user-driven; Partially
// Received/Received are set automatically inside create_grn_transactional
// once GRNs are posted against this PO, never via this transition map.
const ALLOWED_TRANSITIONS = {
  Draft: ["Pending Approval", "Cancelled"],
  "Pending Approval": ["Approved", "Rejected"],
  Approved: ["Sent", "Cancelled"],
  Sent: ["Cancelled"],
};

async function recordHistory({ purchaseOrderId, fromStatus, toStatus, changedBy, remarks }) {
  const { error } = await supabase.from("purchase_order_status_history").insert({
    purchase_order_id: purchaseOrderId,
    from_status: fromStatus,
    to_status: toStatus,
    changed_by: changedBy || null,
    remarks: remarks || null,
  });
  if (error) console.error("Purchase order status history insert failed:", error.message);
}

async function transition(req, res, { toStatus, requireRemarksField, extraUpdate = {} } = {}) {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid purchase order ID" });
    }
    const { data: po } = await supabase.from("purchase_orders").select("id, status, created_by").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!po) {
      return res.status(404).json({ success: false, message: "Purchase order not found" });
    }
    const allowed = ALLOWED_TRANSITIONS[po.status] || [];
    if (!allowed.includes(toStatus)) {
      return res.status(400).json({ success: false, message: `Cannot move a purchase order from '${po.status}' to '${toStatus}'` });
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
    const { data, error } = await supabase.from("purchase_orders").update(updateData).eq("id", id).select(SELECT).single();
    if (error) throw error;

    await recordHistory({
      purchaseOrderId: id,
      fromStatus: po.status,
      toStatus,
      changedBy: req.user?.id || null,
      remarks: requireRemarksField ? req.body[requireRemarksField] : req.body.remarks,
    });

    logAudit({ req, action: "update", module: "purchaseorder", recordId: id, newValue: { status: toStatus } });

    await notifyStatusChange({
      moduleKey: "purchaseorder",
      entityType: "purchaseOrder",
      entityId: id,
      creatorId: po.created_by,
      actorId: req.user?.id || null,
      toStatus,
      title: `Purchase Order ${data.poNumber} -> ${toStatus}`,
      message: `Purchase order ${data.poNumber} moved from ${po.status} to ${toStatus}.`,
      link: `/admin/procurement/purchase-orders/view/${id}`,
    });

    return { data };
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating purchase order status: " + error.message });
    return null;
  }
}

// Manual creation -- not every purchase order needs a multi-vendor RFQ
// round first; see rfq.controller.js#recordVendorQuote/select-winning-quote
// for the RFQ-spawned path.
exports.createPurchaseOrder = async (req, res) => {
  try {
    const { vendorId, companyName, expectedDate, notes, items } = req.body;
    if (!isValidId(vendorId) || !isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid vendor or company ID" });
    }
    const { data: vendor } = await supabase.from("vendors").select("id").eq("id", vendorId).eq("is_delete", false).maybeSingle();
    if (!vendor) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
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

    const { data: poId, error } = await supabase.rpc("create_purchase_order_transactional", {
      p_vendor_id: vendorId,
      p_company_name_id: companyName,
      p_expected_date: expectedDate || null,
      p_notes: notes || null,
      p_created_by: req.user?.id || null,
      p_initials: initials,
      p_items: items.map((i) => ({ materialId: i.materialId, quantityOrdered: Number(i.quantityOrdered), rate: Number(i.rate) })),
    });
    if (error) throw error;

    const { data: populated } = await supabase.from("purchase_orders").select(SELECT).eq("id", poId).single();
    logAudit({ req, action: "create", module: "purchaseorder", recordId: poId, newValue: populated });

    res.status(201).json({ success: true, message: "Purchase order created successfully", data: withMongoId(populated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating purchase order: " + error.message });
  }
};

exports.getAllPurchaseOrders = async (req, res) => {
  try {
    const { status, vendorId, search, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("purchase_orders").select(SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    if (vendorId) query = query.eq("vendor_id", vendorId);
    if (search && String(search).trim()) query = query.ilike("po_number", `%${String(search).trim()}%`);
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
    res.status(500).json({ success: false, message: "Error fetching purchase orders: " + error.message });
  }
};

exports.getPurchaseOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid purchase order ID" });
    }
    const { data: po, error } = await supabase.from("purchase_orders").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!po) {
      return res.status(404).json({ success: false, message: "Purchase order not found" });
    }
    const { data: items } = await supabase.from("purchase_order_items").select(ITEM_SELECT).eq("purchase_order_id", id);
    res.status(200).json({ success: true, data: withMongoId({ ...po, items: items || [] }) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching purchase order: " + error.message });
  }
};

exports.updatePurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid purchase order ID" });
    }
    const { data: existing } = await supabase.from("purchase_orders").select("id, status").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!existing) {
      return res.status(404).json({ success: false, message: "Purchase order not found" });
    }
    if (existing.status !== "Draft") {
      return res.status(400).json({ success: false, message: "Only a Draft purchase order can be edited" });
    }
    const { expectedDate, notes } = req.body;
    const updateData = {
      ...(expectedDate !== undefined && { expected_date: expectedDate }),
      ...(notes !== undefined && { notes }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };
    const { data, error } = await supabase.from("purchase_orders").update(updateData).eq("id", id).select(SELECT).single();
    if (error) throw error;

    logAudit({ req, action: "update", module: "purchaseorder", recordId: id, newValue: data });
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating purchase order: " + error.message });
  }
};

exports.deletePurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid purchase order ID" });
    }
    const { data, error } = await supabase.from("purchase_orders").update({ is_delete: true }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Purchase order not found" });
    }
    logAudit({ req, action: "delete", module: "purchaseorder", recordId: id });
    res.status(200).json({ success: true, message: "Purchase order deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting purchase order: " + error.message });
  }
};

exports.submitForApproval = async (req, res) => {
  const result = await transition(req, res, { toStatus: "Pending Approval" });
  if (result) res.status(200).json({ success: true, message: "Purchase order submitted for approval", data: withMongoId(result.data) });
};

exports.approvePurchaseOrder = async (req, res) => {
  const result = await transition(req, res, {
    toStatus: "Approved",
    extraUpdate: { approved_by: req.user?.id || null, approved_at: new Date().toISOString() },
  });
  if (result) res.status(200).json({ success: true, message: "Purchase order approved", data: withMongoId(result.data) });
};

exports.rejectPurchaseOrder = async (req, res) => {
  const result = await transition(req, res, { toStatus: "Rejected", requireRemarksField: "remarks" });
  if (result) res.status(200).json({ success: true, message: "Purchase order rejected", data: withMongoId(result.data) });
};

exports.sendPurchaseOrder = async (req, res) => {
  const result = await transition(req, res, { toStatus: "Sent", extraUpdate: { sent_at: new Date().toISOString() } });
  if (result) res.status(200).json({ success: true, message: "Purchase order sent", data: withMongoId(result.data) });
};

exports.cancelPurchaseOrder = async (req, res) => {
  const result = await transition(req, res, { toStatus: "Cancelled", requireRemarksField: "remarks" });
  if (result) res.status(200).json({ success: true, message: "Purchase order cancelled", data: withMongoId(result.data) });
};

exports.acknowledgePurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid purchase order ID" });
    }
    const { data: po } = await supabase.from("purchase_orders").select("id, status, acknowledged_at").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!po) {
      return res.status(404).json({ success: false, message: "Purchase order not found" });
    }
    if (!ACKNOWLEDGEABLE_PO_STATUSES.includes(po.status)) {
      return res.status(400).json({ success: false, message: `Cannot acknowledge a purchase order in '${po.status}' status` });
    }
    if (po.acknowledged_at) {
      return res.status(400).json({ success: false, message: "This purchase order has already been acknowledged" });
    }
    const { data, error } = await supabase
      .from("purchase_orders")
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: req.user?.id || null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(SELECT)
      .single();
    if (error) throw error;
    logAudit({ req, action: "update", module: "purchaseorder", recordId: id, newValue: data });
    res.status(200).json({ success: true, message: "Purchase order acknowledged", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error acknowledging purchase order: " + error.message });
  }
};

// Selects one vendor's quote as the winner of a closed-out RFQ round and
// spawns a new Draft PO from it -- see select_winning_quote_and_create_po_transactional.
exports.selectWinningQuote = async (req, res) => {
  try {
    const { quoteId } = req.params;
    const { expectedDate, notes } = req.body;
    if (!isValidId(quoteId)) {
      return res.status(400).json({ success: false, message: "Invalid quote ID" });
    }
    const { data: quote } = await supabase
      .from("rfq_vendor_quotes")
      .select("id, status, rfq_id, rfqs:rfq_id(id, status, companyRow:company_name_id(company_name))")
      .eq("id", quoteId)
      .maybeSingle();
    if (!quote) {
      return res.status(404).json({ success: false, message: "Vendor quote not found" });
    }
    if (quote.status !== "Quoted") {
      return res.status(400).json({ success: false, message: "Only a Quoted vendor quote can be selected as the winner" });
    }
    if (quote.rfqs?.status !== "Sent") {
      return res.status(400).json({ success: false, message: "This RFQ has already been closed" });
    }

    const initials = deriveInitials(quote.rfqs?.companyRow?.company_name);

    const { data: poId, error } = await supabase.rpc("select_winning_quote_and_create_po_transactional", {
      p_rfq_vendor_quote_id: quoteId,
      p_expected_date: expectedDate || null,
      p_notes: notes || null,
      p_created_by: req.user?.id || null,
      p_initials: initials,
    });
    if (error) throw error;

    const { data: populated } = await supabase.from("purchase_orders").select(SELECT).eq("id", poId).single();
    logAudit({ req, action: "create", module: "purchaseorder", recordId: poId, newValue: populated });

    res.status(201).json({ success: true, message: "Vendor quote selected; purchase order created", data: withMongoId(populated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error selecting winning quote: " + error.message });
  }
};

exports.getPurchaseOrderHistory = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid purchase order ID" });
    }
    const { data, error } = await supabase
      .from("purchase_order_status_history")
      .select("id, fromStatus:from_status, toStatus:to_status, remarks, createdAt:created_at, changedBy:changed_by(id, firstName:first_name, lastName:last_name)")
      .eq("purchase_order_id", id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching purchase order history: " + error.message });
  }
};
