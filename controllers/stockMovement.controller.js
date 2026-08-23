// Module 11 Part A: Stock Transfer, Stock Adjustment, and Stock Reservation.
// Transfer/Adjustment post through transactional RPCs (mirrors the GRN/
// wastage pattern -- one inventories row per movement, no new
// inventories.type value). Reservation is a soft hold: it writes no
// inventories row, it only narrows what getAvailability() reports as
// Available (On Hand minus active reservations).
const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, deriveInitials } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

const TRANSFER_SELECT = `
  id, transferNumber:transfer_number, quantity, category, transferDate:transfer_date, notes, createdAt:created_at,
  material:material_id(id, materialName:material_name),
  fromWarehouse:from_warehouse_id(id, warehouseName:warehouse_name),
  toWarehouse:to_warehouse_id(id, warehouseName:warehouse_name),
  companyName:company_name_id(id, companyName:company_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

const ADJUSTMENT_SELECT = `
  id, adjustmentNumber:adjustment_number, category, adjustmentType:adjustment_type, quantity, reason,
  adjustmentDate:adjustment_date, createdAt:created_at,
  material:material_id(id, materialName:material_name),
  warehouse:warehouse_id(id, warehouseName:warehouse_name),
  companyName:company_name_id(id, companyName:company_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

const RESERVATION_SELECT = `
  id, reservationNumber:reservation_number, category, quantity, reservedFor:reserved_for, status, notes,
  createdAt:created_at, updatedAt:updated_at,
  material:material_id(id, materialName:material_name),
  warehouse:warehouse_id(id, warehouseName:warehouse_name),
  companyName:company_name_id(id, companyName:company_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

async function resolveInitials(companyNameId) {
  const { data: company } = await supabase.from("company_names").select("company_name").eq("id", companyNameId).maybeSingle();
  return deriveInitials(company?.company_name);
}

// ---------- Stock Transfer ----------

exports.createStockTransfer = async (req, res) => {
  try {
    const { materialId, quantity, category, fromWarehouse, toWarehouse, companyName, forRole, forCompany, transferDate, notes } = req.body;
    if (!isValidId(materialId) || !isValidId(toWarehouse) || !isValidId(companyName) || !isValidId(forRole) || !isValidId(forCompany)) {
      return res.status(400).json({ success: false, message: "Invalid materialId, toWarehouse, companyName, forRole, or forCompany" });
    }
    if (fromWarehouse && !isValidId(fromWarehouse)) {
      return res.status(400).json({ success: false, message: "Invalid fromWarehouse" });
    }
    if (fromWarehouse && String(fromWarehouse) === String(toWarehouse)) {
      return res.status(400).json({ success: false, message: "fromWarehouse and toWarehouse must be different" });
    }

    const { data: toWh } = await supabase.from("warehouses").select("id").eq("id", toWarehouse).eq("is_delete", false).maybeSingle();
    if (!toWh) {
      return res.status(404).json({ success: false, message: "Destination warehouse not found" });
    }
    if (fromWarehouse) {
      const { data: fromWh } = await supabase.from("warehouses").select("id").eq("id", fromWarehouse).eq("is_delete", false).maybeSingle();
      if (!fromWh) {
        return res.status(404).json({ success: false, message: "Source warehouse not found" });
      }
    }

    const initials = await resolveInitials(companyName);
    const { data: transferNumber, error: numErr } = await supabase.rpc("next_document_number", {
      p_doc_type: "stock_transfer",
      p_initials: initials,
    });
    if (numErr) throw numErr;

    const { data: transferId, error } = await supabase.rpc("record_stock_transfer_transactional", {
      p_material_id: materialId,
      p_quantity: Number(quantity),
      p_category: category,
      p_from_warehouse_id: fromWarehouse || null,
      p_to_warehouse_id: toWarehouse,
      p_company_name_id: companyName,
      p_for_role_id: forRole,
      p_for_company_id: forCompany,
      p_transfer_date: transferDate || new Date().toISOString().slice(0, 10),
      p_notes: notes || null,
      p_created_by: req.user?.id || null,
      p_transfer_number: transferNumber,
    });
    if (error) throw error;

    const { data } = await supabase.from("stock_transfers").select(TRANSFER_SELECT).eq("id", transferId).single();
    logAudit({ req, action: "create", module: "stock_transfer", recordId: transferId, newValue: data });
    res.status(201).json({ success: true, message: "Stock transfer recorded successfully", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error recording stock transfer: " + error.message });
  }
};

exports.getAllStockTransfers = async (req, res) => {
  try {
    const { materialId, warehouse, companyName, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;
    let query = supabase.from("stock_transfers").select(TRANSFER_SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (materialId) query = query.eq("material_id", materialId);
    if (companyName) query = query.eq("company_name_id", companyName);
    if (warehouse) query = query.or(`from_warehouse_id.eq.${warehouse},to_warehouse_id.eq.${warehouse}`);

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
    res.status(500).json({ success: false, message: "Error fetching stock transfers: " + error.message });
  }
};

// ---------- Stock Adjustment ----------

exports.createStockAdjustment = async (req, res) => {
  try {
    const { materialId, warehouse, category, adjustmentType, quantity, reason, companyName, forRole, forCompany, adjustmentDate } = req.body;
    if (!isValidId(materialId) || !isValidId(companyName) || !isValidId(forRole) || !isValidId(forCompany)) {
      return res.status(400).json({ success: false, message: "Invalid materialId, companyName, forRole, or forCompany" });
    }
    if (warehouse && !isValidId(warehouse)) {
      return res.status(400).json({ success: false, message: "Invalid warehouse" });
    }
    if (!["Increase", "Decrease"].includes(adjustmentType)) {
      return res.status(400).json({ success: false, message: "adjustmentType must be 'Increase' or 'Decrease'" });
    }

    const initials = await resolveInitials(companyName);
    const { data: adjustmentNumber, error: numErr } = await supabase.rpc("next_document_number", {
      p_doc_type: "stock_adjustment",
      p_initials: initials,
    });
    if (numErr) throw numErr;

    const { data: adjustmentId, error } = await supabase.rpc("record_stock_adjustment_transactional", {
      p_material_id: materialId,
      p_warehouse_id: warehouse || null,
      p_category: category,
      p_adjustment_type: adjustmentType,
      p_quantity: Number(quantity),
      p_reason: reason,
      p_company_name_id: companyName,
      p_for_role_id: forRole,
      p_for_company_id: forCompany,
      p_adjustment_date: adjustmentDate || new Date().toISOString().slice(0, 10),
      p_created_by: req.user?.id || null,
      p_adjustment_number: adjustmentNumber,
    });
    if (error) throw error;

    const { data } = await supabase.from("stock_adjustments").select(ADJUSTMENT_SELECT).eq("id", adjustmentId).single();
    logAudit({ req, action: "create", module: "stock_adjustment", recordId: adjustmentId, newValue: data });
    res.status(201).json({ success: true, message: "Stock adjustment recorded successfully", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error recording stock adjustment: " + error.message });
  }
};

exports.getAllStockAdjustments = async (req, res) => {
  try {
    const { materialId, warehouse, companyName, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;
    let query = supabase.from("stock_adjustments").select(ADJUSTMENT_SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (materialId) query = query.eq("material_id", materialId);
    if (companyName) query = query.eq("company_name_id", companyName);
    if (warehouse) query = query.eq("warehouse_id", warehouse);

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
    res.status(500).json({ success: false, message: "Error fetching stock adjustments: " + error.message });
  }
};

// ---------- Stock Reservation ----------

exports.createStockReservation = async (req, res) => {
  try {
    const { materialId, warehouse, category, quantity, reservedFor, notes, companyName, forRole, forCompany } = req.body;
    if (!isValidId(materialId) || !isValidId(companyName) || !isValidId(forRole) || !isValidId(forCompany)) {
      return res.status(400).json({ success: false, message: "Invalid materialId, companyName, forRole, or forCompany" });
    }
    if (warehouse && !isValidId(warehouse)) {
      return res.status(400).json({ success: false, message: "Invalid warehouse" });
    }

    const initials = await resolveInitials(companyName);
    const { data: reservationNumber, error: numErr } = await supabase.rpc("next_document_number", {
      p_doc_type: "stock_reservation",
      p_initials: initials,
    });
    if (numErr) throw numErr;

    const { data, error } = await supabase
      .from("stock_reservations")
      .insert({
        reservation_number: reservationNumber,
        material_id: materialId,
        warehouse_id: warehouse || null,
        category: category || null,
        quantity: Number(quantity),
        reserved_for: reservedFor || null,
        notes: notes || null,
        company_name_id: companyName,
        for_role_id: forRole,
        for_company_id: forCompany,
        created_by: req.user?.id || null,
      })
      .select(RESERVATION_SELECT)
      .single();
    if (error) throw error;

    logAudit({ req, action: "create", module: "stock_reservation", recordId: data.id, newValue: data });
    res.status(201).json({ success: true, message: "Stock reservation created successfully", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating stock reservation: " + error.message });
  }
};

exports.getAllStockReservations = async (req, res) => {
  try {
    const { materialId, warehouse, status, companyName, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;
    let query = supabase.from("stock_reservations").select(RESERVATION_SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (materialId) query = query.eq("material_id", materialId);
    if (companyName) query = query.eq("company_name_id", companyName);
    if (warehouse) query = query.eq("warehouse_id", warehouse);
    if (status) query = query.eq("status", status);

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
    res.status(500).json({ success: false, message: "Error fetching stock reservations: " + error.message });
  }
};

// Status transitions: Active -> Consumed | Cancelled only. Once Consumed or
// Cancelled a reservation is terminal (matches the transition-guard style
// used across Quotation/PO/Opportunity).
exports.updateStockReservationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid reservation ID" });
    }
    if (!["Consumed", "Cancelled"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be 'Consumed' or 'Cancelled'" });
    }
    const { data: existing } = await supabase.from("stock_reservations").select("id, status").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!existing) {
      return res.status(404).json({ success: false, message: "Reservation not found" });
    }
    if (existing.status !== "Active") {
      return res.status(400).json({ success: false, message: `Cannot change a reservation that is already '${existing.status}'` });
    }
    const { data, error } = await supabase
      .from("stock_reservations")
      .update({ status, updated_at: new Date().toISOString(), updated_by: req.user?.id || null })
      .eq("id", id)
      .select(RESERVATION_SELECT)
      .single();
    if (error) throw error;
    logAudit({ req, action: "update", module: "stock_reservation", recordId: id, newValue: data });
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating reservation status: " + error.message });
  }
};

exports.deleteStockReservation = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid reservation ID" });
    }
    const { data, error } = await supabase.from("stock_reservations").update({ is_delete: true }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Reservation not found" });
    }
    logAudit({ req, action: "delete", module: "stock_reservation", recordId: id });
    res.status(200).json({ success: true, message: "Reservation deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting reservation: " + error.message });
  }
};
