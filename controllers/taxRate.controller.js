// Module 10: Tax Rate master -- a convenience picker for invoice/quotation
// GST line entry, per the design decision. Deliberately NOT enforced:
// invoice_items.gst_rate/quotations.gst_percentage stay free-typed numerics
// (see their existing validators), so this master never breaks a rate that
// was previously accepted.
const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

const SELECT = `
  id, name, ratePercent:rate_percent, isDefault:is_default, status,
  createdAt:created_at, updatedAt:updated_at,
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

exports.createTaxRate = async (req, res) => {
  try {
    const { name, ratePercent, isDefault, status } = req.body;
    const { data: existing } = await supabase.from("tax_rates").select("id").ilike("name", name).eq("is_delete", false).maybeSingle();
    if (existing) {
      return res.status(400).json({ success: false, message: "A tax rate with this name already exists" });
    }
    if (isDefault) {
      await supabase.from("tax_rates").update({ is_default: false }).eq("is_default", true);
    }
    const { data, error } = await supabase
      .from("tax_rates")
      .insert({
        name,
        rate_percent: Number(ratePercent),
        is_default: Boolean(isDefault),
        status: status || "Active",
        created_by: req.user?.id || null,
      })
      .select(SELECT)
      .single();
    if (error) throw error;
    logAudit({ req, action: "create", module: "taxrate", recordId: data.id, newValue: data });
    res.status(201).json({ success: true, message: "Tax rate created successfully", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating tax rate: " + error.message });
  }
};

exports.getAllTaxRates = async (req, res) => {
  try {
    const { status, search } = req.query;
    let query = supabase.from("tax_rates").select(SELECT).eq("is_delete", false).order("rate_percent", { ascending: true });
    if (status) query = query.eq("status", status);
    if (search && String(search).trim()) query = query.ilike("name", `%${String(search).trim()}%`);
    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching tax rates: " + error.message });
  }
};

exports.updateTaxRate = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid tax rate ID" });
    }
    const { name, ratePercent, isDefault, status } = req.body;
    if (name !== undefined) {
      const { data: existing } = await supabase.from("tax_rates").select("id").ilike("name", name).eq("is_delete", false).neq("id", id).maybeSingle();
      if (existing) {
        return res.status(400).json({ success: false, message: "A tax rate with this name already exists" });
      }
    }
    if (isDefault) {
      await supabase.from("tax_rates").update({ is_default: false }).eq("is_default", true).neq("id", id);
    }
    const updateData = {
      ...(name !== undefined && { name }),
      ...(ratePercent !== undefined && { rate_percent: Number(ratePercent) }),
      ...(isDefault !== undefined && { is_default: Boolean(isDefault) }),
      ...(status !== undefined && { status }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };
    const { data, error } = await supabase.from("tax_rates").update(updateData).eq("id", id).select(SELECT).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Tax rate not found" });
    }
    logAudit({ req, action: "update", module: "taxrate", recordId: id, newValue: data });
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating tax rate: " + error.message });
  }
};

exports.deleteTaxRate = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid tax rate ID" });
    }
    const { data, error } = await supabase.from("tax_rates").update({ is_delete: true }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Tax rate not found" });
    }
    logAudit({ req, action: "delete", module: "taxrate", recordId: id });
    res.status(200).json({ success: true, message: "Tax rate deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting tax rate: " + error.message });
  }
};
