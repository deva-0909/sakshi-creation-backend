const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");

// Module 10: this table/controller was originally wired for order statuses
// only; it's now the generalized status-vocabulary mechanism behind the
// activation/deactivation toggle for these masters too (see
// remediation-patch-plan.md's activation-pattern decision). Each of these
// types was seeded with an Active/Inactive pair; admins can add more (e.g.
// "On Hold") through this same endpoint family.
const SUPPORTED_TYPES = ["order", "vendor", "material", "company_name", "product_item", "role", "machine", "uom", "tax_rate", "branch", "designation", "warehouse"];

const SELECT = `
  id, name, orderNumber:order_number, isDefault:is_default, isActive:is_active, color, description,
  statusType:status_type, createdAt:created_at, updatedAt:updated_at,
  createdBy:created_by(id, name:first_name)
`;

function assertType(type, res) {
  if (!SUPPORTED_TYPES.includes(type.toLowerCase())) {
    res.status(400).json({
      success: false,
      message: `Invalid status type: ${type}. Supported types: ${SUPPORTED_TYPES.join(", ")}`,
    });
    return false;
  }
  return true;
}

exports.createStatus = async (req, res) => {
  try {
    const { type } = req.params;
    if (!assertType(type, res)) return;
    const { name, orderNumber, isDefault, isActive, color, description } = req.body;

    if (!name || !orderNumber) {
      return res.status(400).json({ success: false, message: "Name and Order Number are required" });
    }

    const { data: existing } = await supabase
      .from("order_statuses")
      .select("id")
      .eq("status_type", type.toLowerCase())
      .eq("order_number", orderNumber)
      .maybeSingle();
    if (existing) {
      return res.status(400).json({ success: false, message: `Order number ${orderNumber} already exists for ${type} status` });
    }

    if (isDefault) {
      await supabase.from("order_statuses").update({ is_default: false }).eq("status_type", type.toLowerCase()).eq("is_default", true);
    }

    const { data: inserted, error } = await supabase
      .from("order_statuses")
      .insert({
        name: name.trim(),
        order_number: parseInt(orderNumber, 10),
        is_default: Boolean(isDefault),
        is_active: isActive !== undefined ? Boolean(isActive) : true,
        color: color || "#6B7280",
        description: description || "",
        created_by: req.user?.id,
        status_type: type.toLowerCase(),
      })
      .select("id")
      .single();
    if (error) throw error;

    const { data: populated } = await supabase.from("order_statuses").select(SELECT).eq("id", inserted.id).single();

    res.status(201).json({ success: true, message: `${type} status created successfully`, data: withMongoId(populated) });
  } catch (error) {
    console.error(`Create ${req.params.type} status error:`, error);
    res.status(500).json({ success: false, message: `Failed to create ${req.params.type} status`, error: error.message });
  }
};

exports.getAllStatuses = async (req, res) => {
  try {
    const { type } = req.params;
    if (!assertType(type, res)) return;
    const { page = 1, limit = 50, isActive, search } = req.query;

    let query = supabase.from("order_statuses").select(SELECT, { count: "exact" }).eq("status_type", type.toLowerCase());
    if (isActive !== undefined) query = query.eq("is_active", isActive === "true" || isActive === true);
    if (search) query = query.ilike("name", `%${search}%`);

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;
    query = query.order("order_number", { ascending: true }).range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    res.status(200).json({
      success: true,
      data: withMongoId(data),
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(count / limitNum),
        totalCount: count,
        hasNext: from + data.length < count,
        hasPrev: pageNum > 1,
      },
    });
  } catch (error) {
    console.error(`Get all ${req.params.type} statuses error:`, error);
    res.status(500).json({ success: false, message: `Failed to fetch ${req.params.type} statuses`, error: error.message });
  }
};

exports.getStatusById = async (req, res) => {
  try {
    const { type, id } = req.params;
    if (!assertType(type, res)) return;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid Status ID" });
    }
    const { data, error } = await supabase.from("order_statuses").select(SELECT).eq("id", id).eq("status_type", type.toLowerCase()).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: `${type} status not found` });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    console.error(`Get ${req.params.type} status by ID error:`, error);
    res.status(500).json({ success: false, message: `Failed to fetch ${req.params.type} status`, error: error.message });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { type, id } = req.params;
    if (!assertType(type, res)) return;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid Status ID" });
    }
    const updateData = { ...req.body };

    if (updateData.orderNumber) {
      const { data: existing } = await supabase
        .from("order_statuses")
        .select("id")
        .eq("status_type", type.toLowerCase())
        .eq("order_number", updateData.orderNumber)
        .neq("id", id)
        .maybeSingle();
      if (existing) {
        return res.status(400).json({ success: false, message: `Order number ${updateData.orderNumber} already exists for ${type} status` });
      }
    }

    if (updateData.isDefault) {
      await supabase.from("order_statuses").update({ is_default: false }).eq("status_type", type.toLowerCase()).eq("is_default", true).neq("id", id);
    }

    const patch = {
      ...(updateData.name && { name: updateData.name }),
      ...(updateData.orderNumber && { order_number: parseInt(updateData.orderNumber, 10) }),
      ...(updateData.isDefault !== undefined && { is_default: Boolean(updateData.isDefault) }),
      ...(updateData.isActive !== undefined && { is_active: Boolean(updateData.isActive) }),
      ...(updateData.color && { color: updateData.color }),
      ...(updateData.description !== undefined && { description: updateData.description }),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from("order_statuses").update(patch).eq("id", id).select(SELECT).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: `${type} status not found` });
    }
    res.status(200).json({ success: true, message: `${type} status updated successfully`, data: withMongoId(data) });
  } catch (error) {
    console.error(`Update ${req.params.type} status error:`, error);
    res.status(500).json({ success: false, message: `Failed to update ${req.params.type} status`, error: error.message });
  }
};

exports.deleteStatus = async (req, res) => {
  try {
    const { type, id } = req.params;
    if (!assertType(type, res)) return;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid Status ID" });
    }
    const { data: status } = await supabase.from("order_statuses").select("id, is_default").eq("id", id).maybeSingle();
    if (!status) {
      return res.status(404).json({ success: false, message: `${type} status not found` });
    }
    if (status.is_default) {
      return res.status(400).json({ success: false, message: `Cannot delete default ${type} status` });
    }
    await supabase.from("order_statuses").delete().eq("id", id);
    res.status(200).json({ success: true, message: `${type} status deleted successfully`, data: { id } });
  } catch (error) {
    console.error(`Delete ${req.params.type} status error:`, error);
    res.status(500).json({ success: false, message: `Failed to delete ${req.params.type} status`, error: error.message });
  }
};

exports.getDefaultStatus = async (req, res) => {
  try {
    const { type } = req.params;
    if (!assertType(type, res)) return;
    const { data, error } = await supabase
      .from("order_statuses")
      .select(SELECT)
      .eq("status_type", type.toLowerCase())
      .eq("is_default", true)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: `No default ${type} status found` });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    console.error(`Get default ${req.params.type} status error:`, error);
    res.status(500).json({ success: false, message: `Failed to fetch default ${req.params.type} status`, error: error.message });
  }
};

exports.reorderStatuses = async (req, res) => {
  try {
    const { type } = req.params;
    if (!assertType(type, res)) return;
    const { statusIds } = req.body;
    if (!Array.isArray(statusIds) || statusIds.length === 0) {
      return res.status(400).json({ success: false, message: "Status IDs array is required" });
    }

    await Promise.all(statusIds.map((id, index) => supabase.from("order_statuses").update({ order_number: index + 1 }).eq("id", id)));

    const { data, error } = await supabase.from("order_statuses").select(SELECT).in("id", statusIds).order("order_number", { ascending: true });
    if (error) throw error;

    res.status(200).json({ success: true, message: `${type} statuses reordered successfully`, data: withMongoId(data) });
  } catch (error) {
    console.error(`Reorder ${req.params.type} statuses error:`, error);
    res.status(500).json({ success: false, message: `Failed to reorder ${req.params.type} statuses`, error: error.message });
  }
};
