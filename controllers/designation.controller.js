// Module 10: Designation master -- previously no designation/job-title
// concept existed anywhere; staff.designation_id (nullable) is the only
// place this is wired in for now.
const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

const SELECT = `
  id, designationName:designation_name, status, createdAt:created_at, updatedAt:updated_at,
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

exports.createDesignation = async (req, res) => {
  try {
    const { designationName, status } = req.body;
    const { data: existing } = await supabase.from("designations").select("id").ilike("designation_name", designationName).eq("is_delete", false).maybeSingle();
    if (existing) {
      return res.status(400).json({ success: false, message: "A designation with this name already exists" });
    }
    const { data, error } = await supabase
      .from("designations")
      .insert({ designation_name: designationName, status: status || "Active", created_by: req.user?.id || null })
      .select(SELECT)
      .single();
    if (error) throw error;
    logAudit({ req, action: "create", module: "designation", recordId: data.id, newValue: data });
    res.status(201).json({ success: true, message: "Designation created successfully", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating designation: " + error.message });
  }
};

exports.getAllDesignations = async (req, res) => {
  try {
    const { status, search } = req.query;
    let query = supabase.from("designations").select(SELECT).eq("is_delete", false).order("designation_name", { ascending: true });
    if (status) query = query.eq("status", status);
    if (search && String(search).trim()) query = query.ilike("designation_name", `%${String(search).trim()}%`);
    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching designations: " + error.message });
  }
};

exports.updateDesignation = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid designation ID" });
    }
    const { designationName, status } = req.body;
    if (designationName !== undefined) {
      const { data: existing } = await supabase
        .from("designations")
        .select("id")
        .ilike("designation_name", designationName)
        .eq("is_delete", false)
        .neq("id", id)
        .maybeSingle();
      if (existing) {
        return res.status(400).json({ success: false, message: "A designation with this name already exists" });
      }
    }
    const updateData = {
      ...(designationName !== undefined && { designation_name: designationName }),
      ...(status !== undefined && { status }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };
    const { data, error } = await supabase.from("designations").update(updateData).eq("id", id).select(SELECT).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Designation not found" });
    }
    logAudit({ req, action: "update", module: "designation", recordId: id, newValue: data });
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating designation: " + error.message });
  }
};

exports.deleteDesignation = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid designation ID" });
    }
    const { data, error } = await supabase.from("designations").update({ is_delete: true }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Designation not found" });
    }
    logAudit({ req, action: "delete", module: "designation", recordId: id });
    res.status(200).json({ success: true, message: "Designation deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting designation: " + error.message });
  }
};
