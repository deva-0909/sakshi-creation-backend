// Module 10: Branch master -- previously no branch concept existed
// anywhere; staff.branch_id (nullable) is the only place this is wired in
// for now.
const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

const SELECT = `
  id, branchName:branch_name, address, status, createdAt:created_at, updatedAt:updated_at,
  companyName:company_name_id(id, companyName:company_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

exports.createBranch = async (req, res) => {
  try {
    const { branchName, companyName, address, status } = req.body;
    if (companyName && !isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid ID format for companyName" });
    }
    const { data, error } = await supabase
      .from("branches")
      .insert({
        branch_name: branchName,
        company_name_id: companyName || null,
        address: address || null,
        status: status || "Active",
        created_by: req.user?.id || null,
      })
      .select(SELECT)
      .single();
    if (error) throw error;
    logAudit({ req, action: "create", module: "branch", recordId: data.id, newValue: data });
    res.status(201).json({ success: true, message: "Branch created successfully", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating branch: " + error.message });
  }
};

exports.getAllBranches = async (req, res) => {
  try {
    const { status, companyName, search } = req.query;
    let query = supabase.from("branches").select(SELECT).eq("is_delete", false).order("branch_name", { ascending: true });
    if (status) query = query.eq("status", status);
    if (companyName) query = query.eq("company_name_id", companyName);
    if (search && String(search).trim()) query = query.ilike("branch_name", `%${String(search).trim()}%`);
    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching branches: " + error.message });
  }
};

exports.updateBranch = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid branch ID" });
    }
    const { branchName, companyName, address, status } = req.body;
    const updateData = {
      ...(branchName !== undefined && { branch_name: branchName }),
      ...(companyName !== undefined && { company_name_id: companyName || null }),
      ...(address !== undefined && { address }),
      ...(status !== undefined && { status }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };
    const { data, error } = await supabase.from("branches").update(updateData).eq("id", id).select(SELECT).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Branch not found" });
    }
    logAudit({ req, action: "update", module: "branch", recordId: id, newValue: data });
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating branch: " + error.message });
  }
};

exports.deleteBranch = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid branch ID" });
    }
    const { data, error } = await supabase.from("branches").update({ is_delete: true }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Branch not found" });
    }
    logAudit({ req, action: "delete", module: "branch", recordId: id });
    res.status(200).json({ success: true, message: "Branch deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting branch: " + error.message });
  }
};
