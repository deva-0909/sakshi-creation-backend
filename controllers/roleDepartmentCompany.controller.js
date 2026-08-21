const supabase = require("../lib/supabaseClient");
const { withMongoId } = require("../lib/helpers");

const SELECT =
  "id, roleDepartmentCompanyName:role_department_company_name, roleDepartment:role_department_id(id, roleDepartment:role_department, CompanyName:company_name_id(id, companyName:company_name)), createdAt:created_at";

exports.createRoleDepartmentCompany = async (req, res) => {
  try {
    const { roleDepartment, roleDepartmentCompanyName } = req.body;
    if (!roleDepartment || !roleDepartmentCompanyName) {
      return res.status(400).json({
        success: false,
        message: "Role department ID and role department company name are required",
      });
    }

    const { data: existingRoleDepartment } = await supabase
      .from("role_departments")
      .select("id")
      .eq("id", roleDepartment)
      .maybeSingle();

    if (!existingRoleDepartment) {
      return res.status(400).json({ success: false, message: "Invalid role department ID" });
    }

    const { data: existing } = await supabase
      .from("role_department_companies")
      .select("id")
      .eq("role_department_id", roleDepartment)
      .ilike("role_department_company_name", roleDepartmentCompanyName)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Role department company name already exists for this role department",
      });
    }

    const { data, error } = await supabase
      .from("role_department_companies")
      .insert({
        role_department_id: roleDepartment,
        role_department_company_name: roleDepartmentCompanyName,
      })
      .select(SELECT)
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: "Role department company created successfully",
      data: withMongoId(data),
    });
  } catch (error) {
    console.error("Error creating role department company:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create role department company",
      error: error.message,
    });
  }
};

exports.getAllRoleDepartmentCompanies = async (req, res) => {
  try {
    const { data, error } = await supabase.from("role_department_companies").select(SELECT).eq("is_delete", false);
    if (error) throw error;

    res.status(200).json({
      success: true,
      message: "Role department companies retrieved successfully",
      data: withMongoId(data),
    });
  } catch (error) {
    console.error("Error fetching role department companies:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch role department companies",
      error: error.message,
    });
  }
};

exports.getRoleDepartmentCompanyById = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("role_department_companies")
      .select(SELECT)
      .eq("id", req.params.id)
      .eq("is_delete", false)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Role department company not found" });
    }

    res.status(200).json({
      success: true,
      message: "Role department company retrieved successfully",
      data: withMongoId(data),
    });
  } catch (error) {
    console.error("Error fetching role department company:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch role department company",
      error: error.message,
    });
  }
};

exports.updateRoleDepartmentCompany = async (req, res) => {
  try {
    const { roleDepartment, roleDepartmentCompanyName } = req.body;
    if (!roleDepartment || !roleDepartmentCompanyName) {
      return res.status(400).json({
        success: false,
        message: "Role department ID and role department company name are required",
      });
    }

    const { data: existingRoleDepartment } = await supabase
      .from("role_departments")
      .select("id")
      .eq("id", roleDepartment)
      .maybeSingle();

    if (!existingRoleDepartment) {
      return res.status(400).json({ success: false, message: "Invalid role department ID" });
    }

    const { data: existing } = await supabase
      .from("role_department_companies")
      .select("id")
      .eq("role_department_id", roleDepartment)
      .ilike("role_department_company_name", roleDepartmentCompanyName)
      .neq("id", req.params.id)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Role department company name already exists for this role department",
      });
    }

    const { data, error } = await supabase
      .from("role_department_companies")
      .update({
        role_department_id: roleDepartment,
        role_department_company_name: roleDepartmentCompanyName,
      })
      .eq("id", req.params.id)
      .select(SELECT)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Role department company not found" });
    }

    res.status(200).json({
      success: true,
      message: "Role department company updated successfully",
      data: withMongoId(data),
    });
  } catch (error) {
    console.error("Error updating role department company:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update role department company",
      error: error.message,
    });
  }
};

exports.deleteRoleDepartmentCompany = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("role_department_companies")
      .update({ is_delete: true })
      .eq("id", req.params.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Role department company not found" });
    }

    res.status(200).json({ success: true, message: "Role department company deleted successfully" });
  } catch (error) {
    console.error("Error deleting role department company:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete role department company",
      error: error.message,
    });
  }
};
