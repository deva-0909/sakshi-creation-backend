// Module 10: Unit of Measure master. Wired as an optional uom_id FK on
// product_boms (alongside its existing free-text `unit` column, left
// untouched for backward compatibility) and materials (which previously had
// no unit concept at all).
const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

const SELECT = `
  id, name, symbol, status, createdAt:created_at, updatedAt:updated_at,
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

exports.createUom = async (req, res) => {
  try {
    const { name, symbol, status } = req.body;
    const { data: existing } = await supabase.from("units_of_measure").select("id").ilike("name", name).eq("is_delete", false).maybeSingle();
    if (existing) {
      return res.status(400).json({ success: false, message: "A unit of measure with this name already exists" });
    }
    const { data, error } = await supabase
      .from("units_of_measure")
      .insert({ name, symbol: symbol || null, status: status || "Active", created_by: req.user?.id || null })
      .select(SELECT)
      .single();
    if (error) throw error;
    logAudit({ req, action: "create", module: "uom", recordId: data.id, newValue: data });
    res.status(201).json({ success: true, message: "Unit of measure created successfully", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating unit of measure: " + error.message });
  }
};

exports.getAllUoms = async (req, res) => {
  try {
    const { status, search } = req.query;
    let query = supabase.from("units_of_measure").select(SELECT).eq("is_delete", false).order("name", { ascending: true });
    if (status) query = query.eq("status", status);
    if (search && String(search).trim()) query = query.ilike("name", `%${String(search).trim()}%`);
    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching units of measure: " + error.message });
  }
};

exports.updateUom = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid unit of measure ID" });
    }
    const { name, symbol, status } = req.body;
    if (name !== undefined) {
      const { data: existing } = await supabase.from("units_of_measure").select("id").ilike("name", name).eq("is_delete", false).neq("id", id).maybeSingle();
      if (existing) {
        return res.status(400).json({ success: false, message: "A unit of measure with this name already exists" });
      }
    }
    const updateData = {
      ...(name !== undefined && { name }),
      ...(symbol !== undefined && { symbol }),
      ...(status !== undefined && { status }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };
    const { data, error } = await supabase.from("units_of_measure").update(updateData).eq("id", id).select(SELECT).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Unit of measure not found" });
    }
    logAudit({ req, action: "update", module: "uom", recordId: id, newValue: data });
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating unit of measure: " + error.message });
  }
};

exports.deleteUom = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid unit of measure ID" });
    }
    const { data, error } = await supabase.from("units_of_measure").update({ is_delete: true }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Unit of measure not found" });
    }
    logAudit({ req, action: "delete", module: "uom", recordId: id });
    res.status(200).json({ success: true, message: "Unit of measure deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting unit of measure: " + error.message });
  }
};
