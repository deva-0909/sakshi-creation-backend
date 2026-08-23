const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, deriveInitials, categoryForRole } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");
const { notifyStaff } = require("../lib/notify");

const SELECT = `
  id, grnNumber:grn_number, receivedDate:received_date, notes, createdAt:created_at,
  vendorInvoiceNumber:vendor_invoice_number, vendorInvoiceDate:vendor_invoice_date,
  purchaseOrder:purchase_order_id(id, poNumber:po_number, status),
  vendor:vendor_id(id, name),
  companyName:company_name_id(id, companyName:company_name),
  forRole:for_role_id(id, roleName:role_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

const ITEM_SELECT = `
  id, quantityReceived:quantity_received, rate, purchaseOrderItemId:purchase_order_item_id, inventoryId:inventory_id,
  material:material_id(id, materialName:material_name)
`;

// A GRN can only be posted against a PO that has actually been sent to the
// vendor (or is already partway received) -- receiving against a PO still
// sitting in Draft/Pending Approval/Approved makes no sense, and Rejected/
// Cancelled/Received/no-PO-at-all are all terminal or already-satisfied.
const RECEIVABLE_PO_STATUSES = ["Sent", "Partially Received"];

exports.createGrn = async (req, res) => {
  try {
    const { purchaseOrderId, receivedDate, forRole, forCompany, notes, items, vendorInvoiceNumber, vendorInvoiceDate } = req.body;
    if (!isValidId(purchaseOrderId) || !isValidId(forRole) || !isValidId(forCompany)) {
      return res.status(400).json({ success: false, message: "Invalid purchaseOrderId, forRole, or forCompany" });
    }

    const { data: po } = await supabase
      .from("purchase_orders")
      .select("id, status, vendor_id, company_name_id, created_by, po_number")
      .eq("id", purchaseOrderId)
      .eq("is_delete", false)
      .maybeSingle();
    if (!po) {
      return res.status(404).json({ success: false, message: "Purchase order not found" });
    }
    if (!RECEIVABLE_PO_STATUSES.includes(po.status)) {
      return res.status(400).json({ success: false, message: `Cannot receive against a purchase order in '${po.status}' status` });
    }

    const { data: company } = await supabase.from("company_names").select("id, company_name").eq("id", po.company_name_id).maybeSingle();
    const { data: roleRow } = await supabase.from("roles").select("id, role_name").eq("id", forRole).eq("is_delete", false).maybeSingle();
    if (!roleRow) {
      return res.status(404).json({ success: false, message: "Invalid or deleted role ID" });
    }
    const { data: staffRow } = await supabase.from("staff").select("id").eq("id", forCompany).maybeSingle();
    if (!staffRow) {
      return res.status(404).json({ success: false, message: "forCompany does not reference a valid staff member" });
    }

    const poItemIds = items.map((i) => i.purchaseOrderItemId);
    const { data: poItems } = await supabase
      .from("purchase_order_items")
      .select("id, material_id, quantity_ordered, quantity_received")
      .eq("purchase_order_id", purchaseOrderId)
      .in("id", poItemIds);
    if (!poItems || poItems.length !== new Set(poItemIds).size) {
      return res.status(400).json({ success: false, message: "One or more purchaseOrderItemId values don't belong to this purchase order" });
    }
    for (const item of items) {
      const poItem = poItems.find((p) => p.id === item.purchaseOrderItemId);
      const remaining = Number(poItem.quantity_ordered) - Number(poItem.quantity_received);
      if (Number(item.quantityReceived) > remaining) {
        return res.status(400).json({
          success: false,
          message: `Cannot receive ${item.quantityReceived} against a line with only ${remaining} remaining to receive`,
        });
      }
      if (String(item.materialId) !== String(poItem.material_id)) {
        return res.status(400).json({ success: false, message: "materialId does not match the purchase order line's material" });
      }
    }

    const category = categoryForRole(roleRow.role_name);
    const initials = deriveInitials(company?.company_name);

    const { data: grnId, error } = await supabase.rpc("create_grn_transactional", {
      p_purchase_order_id: purchaseOrderId,
      p_vendor_id: po.vendor_id,
      p_company_name_id: po.company_name_id,
      p_received_date: receivedDate,
      p_for_role_id: forRole,
      p_for_company_id: forCompany,
      p_notes: notes || null,
      p_created_by: req.user?.id || null,
      p_initials: initials,
      p_items: items.map((i) => ({
        purchaseOrderItemId: i.purchaseOrderItemId,
        materialId: i.materialId,
        quantityReceived: Number(i.quantityReceived),
        rate: Number(i.rate),
        category,
      })),
      p_vendor_invoice_number: vendorInvoiceNumber || null,
      p_vendor_invoice_date: vendorInvoiceDate || null,
    });
    if (error) throw error;

    const { data: populated } = await supabase.from("grns").select(SELECT).eq("id", grnId).single();
    const { data: grnItems } = await supabase.from("grn_items").select(ITEM_SELECT).eq("grn_id", grnId);

    logAudit({ req, action: "create", module: "grn", recordId: grnId, newValue: populated });

    // create_grn_transactional auto-recalculates the PO's own status
    // (Partially Received / Received) -- notify its creator that a GRN
    // moved it, the same system-derived-status pattern as receipts on
    // invoices above.
    const { data: poAfter } = await supabase.from("purchase_orders").select("status").eq("id", purchaseOrderId).maybeSingle();
    if (poAfter && poAfter.status !== po.status) {
      await notifyStaff({
        recipientIds: [po.created_by],
        type: "purchaseorder_status",
        title: `Purchase Order ${po.po_number} -> ${poAfter.status}`,
        message: `Purchase order ${po.po_number} moved from ${po.status} to ${poAfter.status} after GRN ${populated.grnNumber}.`,
        entityType: "purchaseOrder",
        entityId: purchaseOrderId,
        link: `/admin/procurement/purchase-orders/view/${purchaseOrderId}`,
      });
    }

    res.status(201).json({ success: true, message: "GRN posted successfully", data: withMongoId({ ...populated, items: grnItems || [] }) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating GRN: " + error.message });
  }
};

exports.getAllGrns = async (req, res) => {
  try {
    const { purchaseOrderId, search, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("grns").select(SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (purchaseOrderId) query = query.eq("purchase_order_id", purchaseOrderId);
    if (search && String(search).trim()) query = query.ilike("grn_number", `%${String(search).trim()}%`);

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
    res.status(500).json({ success: false, message: "Error fetching GRNs: " + error.message });
  }
};

exports.getGrnById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid GRN ID" });
    }
    const { data: grn, error } = await supabase.from("grns").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!grn) {
      return res.status(404).json({ success: false, message: "GRN not found" });
    }
    const { data: items } = await supabase.from("grn_items").select(ITEM_SELECT).eq("grn_id", id);
    res.status(200).json({ success: true, data: withMongoId({ ...grn, items: items || [] }) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching GRN: " + error.message });
  }
};
