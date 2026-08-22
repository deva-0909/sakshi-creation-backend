// Module 10: General Settings -- a generic key/value store rather than a
// fixed column-per-setting table, so a new setting never needs a migration.
// Deliberately no create/delete: the key list is seeded by migration; this
// controller only lists and upserts values for known keys.
const supabase = require("../lib/supabaseClient");
const { withMongoId } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

const SELECT = `id, settingKey:setting_key, settingValue:setting_value, description, updatedAt:updated_at`;

exports.getAllSettings = async (req, res) => {
  try {
    const { data, error } = await supabase.from("app_settings").select(SELECT).order("setting_key", { ascending: true });
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching settings: " + error.message });
  }
};

exports.updateSetting = async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    const { data: existing } = await supabase.from("app_settings").select("id").eq("setting_key", key).maybeSingle();
    if (!existing) {
      return res.status(404).json({ success: false, message: `Unknown setting key: ${key}` });
    }
    const { data, error } = await supabase
      .from("app_settings")
      .update({ setting_value: value === undefined || value === null ? null : String(value), updated_by: req.user?.id || null, updated_at: new Date().toISOString() })
      .eq("setting_key", key)
      .select(SELECT)
      .single();
    if (error) throw error;
    logAudit({ req, action: "update", module: "appsettings", recordId: data.id, newValue: data });
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating setting: " + error.message });
  }
};

// Bulk update -- lets the Setup > General Settings page save the whole form
// in one call instead of one request per field.
exports.updateSettingsBulk = async (req, res) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== "object") {
      return res.status(400).json({ success: false, message: "settings object is required" });
    }
    const entries = Object.entries(settings);
    for (const [key, value] of entries) {
      await supabase
        .from("app_settings")
        .update({ setting_value: value === undefined || value === null ? null : String(value), updated_by: req.user?.id || null, updated_at: new Date().toISOString() })
        .eq("setting_key", key);
    }
    const { data, error } = await supabase.from("app_settings").select(SELECT).order("setting_key", { ascending: true });
    if (error) throw error;
    logAudit({ req, action: "update", module: "appsettings", recordId: null, newValue: settings });
    res.status(200).json({ success: true, message: "Settings updated successfully", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating settings: " + error.message });
  }
};
