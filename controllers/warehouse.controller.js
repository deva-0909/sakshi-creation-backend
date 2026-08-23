// Module 11 Part A: Warehouse master. Single-level (no rack/bin) by design --
// see remediation-patch-plan.md's Module 11 decision. Follows the same
// shape as Branch/Machine: plain status column, generalized activation
// pattern (see statusController.js's SUPPORTED_TYPES).
const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

const SELECT = `
  id, warehouseName:warehouse_name, warehouseCode:warehouse_code, address, status,
  createdAt:created_at, updatedAt:updated_at,
  companyName:company_name_id(id, companyName:company_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

exports.createWarehouse = async (req, res) => {
  try {
    const { warehouseName, warehouseCode, companyName, address, status } = req.body;
    if (companyName && !isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid ID format for companyName" });
    }
    if (companyName) {
      const { data: company } = await supabase.from("company_names").select("id").eq("id", companyName).maybeSingle();
      if (!company) {
        return res.status(404).json({ success: false, message: "Company not found" });
      }
    }
    const { data, error } = await supabase
      .from("warehouses")
      .insert({
        warehouse_name: warehouseName,
        warehouse_code: warehouseCode || null,
        company_name_id: companyName || null,
        address: address || null,
        status: status || "Active",
        created_by: req.user?.id || null,
      })
      .select(SELECT)
      .single();
    if (error) throw error;
    logAudit({ req, action: "create", module: "warehouse", recordId: data.id, newValue: data });
    res.status(201).json({ success: true, message: "Warehouse created successfully", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating warehouse: " + error.message });
  }
};

exports.getAllWarehouses = async (req, res) => {
  try {
    const { status, companyName, search } = req.query;
    let query = supabase.from("warehouses").select(SELECT).eq("is_delete", false).order("warehouse_name", { ascending: true });
    if (status) query = query.eq("status", status);
    if (companyName) query = query.eq("company_name_id", companyName);
    if (search && String(search).trim()) query = query.ilike("warehouse_name", `%${String(search).trim()}%`);
    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching warehouses: " + error.message });
  }
};

exports.getWarehouseById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid warehouse ID" });
    }
    const { data, error } = await supabase.from("warehouses").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Warehouse not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching warehouse: " + error.message });
  }
};

exports.updateWarehouse = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid warehouse ID" });
    }
    const { warehouseName, warehouseCode, companyName, address, status } = req.body;
    if (companyName !== undefined && companyName !== null && !isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid ID format for companyName" });
    }
    const updateData = {
      ...(warehouseName !== undefined && { warehouse_name: warehouseName }),
      ...(warehouseCode !== undefined && { warehouse_code: warehouseCode }),
      ...(companyName !== undefined && { company_name_id: companyName || null }),
      ...(address !== undefined && { address }),
      ...(status !== undefined && { status }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };
    const { data, error } = await supabase.from("warehouses").update(updateData).eq("id", id).select(SELECT).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Warehouse not found" });
    }
    logAudit({ req, action: "update", module: "warehouse", recordId: id, newValue: data });
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating warehouse: " + error.message });
  }
};

exports.deleteWarehouse = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid warehouse ID" });
    }
    const { data, error } = await supabase.from("warehouses").update({ is_delete: true }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Warehouse not found" });
    }
    logAudit({ req, action: "delete", module: "warehouse", recordId: id });
    res.status(200).json({ success: true, message: "Warehouse deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting warehouse: " + error.message });
  }
};
