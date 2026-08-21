const supabase = require("../lib/supabaseClient");
const { withMongoId } = require("../lib/helpers");

const VALID_CATEGORIES = ["printer", "binder", "booklet", "factory", "godown"];

const SELECT = `
  id, category, type, quantity, kg, date, createdAt:created_at,
  material:material_id(id, materialName:material_name, materialSize:material_size, materialGSM:material_gsm),
  vendor:vendor_id(id, name),
  companyName:company_name_id(id, companyName:company_name),
  for:for_role_id(id, roleName:role_name),
  forCompany:for_company_id(id, firstName:first_name, lastName:last_name)
`;

exports.getInventoryByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: "Invalid category" });
    }

    const { data, error } = await supabase
      .from("inventories")
      .select(SELECT)
      .eq("category", category)
      .eq("is_delete", false)
      .order("date", { ascending: false });

    if (error) throw error;

    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching inventory: " + error.message });
  }
};

exports.getInventorySummary = async (req, res) => {
  try {
    const { category } = req.params;
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: "Invalid category" });
    }

    const { data: inward, error: inErr } = await supabase
      .from("inventories")
      .select("quantity")
      .eq("category", category)
      .eq("type", "inward")
      .eq("is_delete", false);
    if (inErr) throw inErr;

    const { data: outward, error: outErr } = await supabase
      .from("inventories")
      .select("quantity")
      .eq("category", category)
      .eq("type", "outward")
      .eq("is_delete", false);
    if (outErr) throw outErr;

    const lastPurchase = (inward || []).reduce((sum, r) => sum + Number(r.quantity || 0), 0);
    const usedQty = (outward || []).reduce((sum, r) => sum + Number(r.quantity || 0), 0);
    const balance = lastPurchase - usedQty;

    res.status(200).json({ success: true, data: { lastPurchase, usedQty, balance } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching inventory summary: " + error.message });
  }
};
