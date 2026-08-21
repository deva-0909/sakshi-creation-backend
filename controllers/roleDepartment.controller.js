const supabase = require("../lib/supabaseClient");
const { withMongoId } = require("../lib/helpers");

const SELECT =
  "id, roleDepartment:role_department, CompanyName:company_name_id(id, companyName:company_name), createdAt:created_at";

exports.createRoleDepartment = async (req, res) => {
  try {
    const { roleDepartment, CompanyName } = req.body;
    if (!roleDepartment || !CompanyName) {
      return res.status(400).json({
        success: false,
        message: "Role department and CompanyName are required",
      });
    }

    const { data: existing } = await supabase
      .from("role_departments")
      .select("id")
      .ilike("role_department", roleDepartment)
      .eq("company_name_id", CompanyName)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Role department already exists for this company",
      });
    }

    const { data, error } = await supabase
      .from("role_departments")
      .insert({ role_department: roleDepartment, company_name_id: CompanyName })
      .select(SELECT)
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: "Role department created successfully",
      data: withMongoId(data),
    });
  } catch (error) {
    console.error("Error creating role department:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create role department",
      error: error.message,
    });
  }
};

exports.getAllRoleDepartments = async (req, res) => {
  try {
    const { data, error } = await supabase.from("role_departments").select(SELECT).eq("is_delete", false);
    if (error) throw error;

    res.status(200).json({
      success: true,
      message: "Role departments retrieved successfully",
      data: withMongoId(data),
    });
  } catch (error) {
    console.error("Error fetching role departments:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch role departments",
      error: error.message,
    });
  }
};

exports.getRoleDepartmentById = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("role_departments")
      .select(SELECT)
      .eq("id", req.params.id)
      .eq("is_delete", false)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Role department not found" });
    }

    res.status(200).json({
      success: true,
      message: "Role department retrieved successfully",
      data: withMongoId(data),
    });
  } catch (error) {
    console.error("Error fetching role department:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch role department",
      error: error.message,
    });
  }
};

exports.updateRoleDepartment = async (req, res) => {
  try {
    const { roleDepartment, CompanyName } = req.body;
    if (!roleDepartment || !CompanyName) {
      return res.status(400).json({
        success: false,
        message: "Role department and CompanyName are required",
      });
    }

    const { data: existing } = await supabase
      .from("role_departments")
      .select("id")
      .ilike("role_department", roleDepartment)
      .eq("company_name_id", CompanyName)
      .neq("id", req.params.id)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Role department already exists for this company",
      });
    }

    const { data, error } = await supabase
      .from("role_departments")
      .update({ role_department: roleDepartment, company_name_id: CompanyName })
      .eq("id", req.params.id)
      .select(SELECT)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Role department not found" });
    }

    res.status(200).json({
      success: true,
      message: "Role department updated successfully",
      data: withMongoId(data),
    });
  } catch (error) {
    console.error("Error updating role department:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update role department",
      error: error.message,
    });
  }
};

exports.deleteRoleDepartment = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("role_departments")
      .update({ is_delete: true })
      .eq("id", req.params.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Role department not found" });
    }

    res.status(200).json({ success: true, message: "Role department deleted successfully" });
  } catch (error) {
    console.error("Error deleting role department:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete role department",
      error: error.message,
    });
  }
};
