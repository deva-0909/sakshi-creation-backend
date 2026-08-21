const supabase = require("../lib/supabaseClient");
const { withMongoId } = require("../lib/helpers");

const SELECT = "id, roleName:role_name, isDelete:is_delete, totalUser:total_user, permissions, createdAt:created_at";

exports.createRole = async (req, res) => {
  const { roleName, permissions } = req.body;
  try {
    if (!roleName || typeof roleName !== "string" || roleName.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Role name is required and must be a non-empty string",
      });
    }

    const { data: existingRole } = await supabase
      .from("roles")
      .select("id")
      .eq("role_name", roleName)
      .maybeSingle();

    if (existingRole) {
      return res.status(406).json({ success: false, message: `${roleName} role already exists` });
    }

    const { data, error } = await supabase
      .from("roles")
      .insert({
        role_name: roleName,
        permissions: permissions || {},
        is_delete: false,
        total_user: 0,
        created_by: req.user?.id || null,
      })
      .select(SELECT)
      .single();

    if (error) throw error;

    res.status(200).json({ success: true, message: "Role created successfully", data: withMongoId(data) });
  } catch (error) {
    console.error("Error creating role:", error);
    res.status(400).json({ success: false, message: error.message || "Error creating role" });
  }
};

exports.getAllRoles = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("roles")
      .select(SELECT)
      .eq("is_delete", false);

    if (error) throw error;

    res.status(200).json({ success: true, message: "Roles retrieved successfully", data: withMongoId(data) });
  } catch (error) {
    console.error("Error fetching roles:", error);
    res.status(400).json({ success: false, message: error.message || "Error fetching roles" });
  }
};

exports.getRoleById = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("roles")
      .select(SELECT)
      .eq("id", req.params.id)
      .eq("is_delete", false)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Role not found" });
    }

    res.status(200).json({ success: true, message: "Role retrieved successfully", data: withMongoId(data) });
  } catch (error) {
    console.error("Error fetching role:", error);
    res.status(400).json({ success: false, message: error.message || "Error fetching role" });
  }
};

exports.updateRoleById = async (req, res) => {
  const { roleName, permissions } = req.body;
  try {
    const { data: role } = await supabase
      .from("roles")
      .select("id, role_name")
      .eq("id", req.params.id)
      .eq("is_delete", false)
      .maybeSingle();

    if (!role) {
      return res.status(404).json({ success: false, message: "Role not found" });
    }

    if (roleName && roleName !== role.role_name) {
      if (typeof roleName !== "string" || roleName.trim() === "") {
        return res.status(400).json({ success: false, message: "Role name must be a non-empty string" });
      }
      const { data: existingRole } = await supabase
        .from("roles")
        .select("id")
        .eq("role_name", roleName)
        .eq("is_delete", false)
        .maybeSingle();
      if (existingRole && existingRole.id !== req.params.id) {
        return res.status(406).json({ success: false, message: `${roleName} role already exists` });
      }
    }

    const updateData = {
      ...(roleName && { role_name: roleName }),
      ...(permissions && { permissions }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };

    const { data: updatedRole, error } = await supabase
      .from("roles")
      .update(updateData)
      .eq("id", req.params.id)
      .select(SELECT)
      .single();

    if (error) throw error;

    res.status(200).json({ success: true, message: "Role updated successfully", data: withMongoId(updatedRole) });
  } catch (error) {
    console.error("Error updating role:", error);
    res.status(400).json({ success: false, message: error.message || "Error updating role" });
  }
};

exports.deleteRoleById = async (req, res) => {
  try {
    const { data: staffWithRole } = await supabase
      .from("staff")
      .select("id")
      .eq("role_id", req.params.id)
      .limit(1)
      .maybeSingle();

    if (staffWithRole) {
      return res.status(400).json({ success: false, message: "Cannot delete role that is assigned to staff" });
    }

    const { data: deletedRole, error } = await supabase
      .from("roles")
      .update({ is_delete: true })
      .eq("id", req.params.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!deletedRole) {
      return res.status(404).json({ success: false, message: "Role not found" });
    }

    res.status(200).json({ success: true, message: "Role deleted successfully" });
  } catch (error) {
    console.error("Error deleting role:", error);
    res.status(400).json({ success: false, message: error.message || "Error deleting role" });
  }
};
