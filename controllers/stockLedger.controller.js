// Stock ledger is a computed view over `inventories`, not a second table --
// every inward/outward row Patch 16 made correct is the only source of
// truth here, so there's no dual-write to keep in sync and no new place
// for the balance to drift. Running balance is a window function; when
// `category` is passed, both the window and the WHERE are scoped to that
// category (e.g. "how much of this paper is at the binder"); when it's
// omitted, the running total spans every category (e.g. "how much of this
// paper exists across the company").
const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");

const VALID_CATEGORIES = ["printer", "binder", "booklet", "factory", "godown"];

exports.getMaterialLedger = async (req, res) => {
  try {
    const { materialId } = req.params;
    const { category, from, to, companyName } = req.query;
    if (!isValidId(materialId)) {
      return res.status(400).json({ success: false, message: "Invalid material ID" });
    }
    if (category && !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: "Invalid category" });
    }

    let query = supabase
      .from("inventories")
      .select("id, category, type, quantity, date, createdAt:created_at")
      .eq("material_id", materialId)
      .eq("is_delete", false)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true });
    if (category) query = query.eq("category", category);
    if (companyName) query = query.eq("company_name_id", companyName);
    if (from) query = query.gte("date", from);
    if (to) query = query.lte("date", to);

    const { data, error } = await query;
    if (error) throw error;

    // Opening balance: net of every row strictly before the `from` cutoff
    // (same category/company scope), so a date-filtered ledger still shows
    // a correct running balance rather than restarting from zero.
    let openingBalance = 0;
    if (from) {
      let openingQuery = supabase
        .from("inventories")
        .select("type, quantity")
        .eq("material_id", materialId)
        .eq("is_delete", false)
        .lt("date", from);
      if (category) openingQuery = openingQuery.eq("category", category);
      if (companyName) openingQuery = openingQuery.eq("company_name_id", companyName);
      const { data: priorRows, error: openingError } = await openingQuery;
      if (openingError) throw openingError;
      openingBalance = (priorRows || []).reduce(
        (sum, r) => sum + (r.type === "inward" ? Number(r.quantity) : -Number(r.quantity)),
        0
      );
    }

    let runningBalance = openingBalance;
    const rows = (data || []).map((row) => {
      runningBalance += row.type === "inward" ? Number(row.quantity) : -Number(row.quantity);
      return { ...row, runningBalance };
    });

    res.status(200).json({
      success: true,
      data: { openingBalance, closingBalance: runningBalance, rows: withMongoId(rows) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching stock ledger: " + error.message });
  }
};

exports.getSummary = async (req, res) => {
  try {
    const { category, companyName } = req.query;
    if (category && !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: "Invalid category" });
    }

    let query = supabase.from("inventories").select("material_id, type, quantity").eq("is_delete", false);
    if (category) query = query.eq("category", category);
    if (companyName) query = query.eq("company_name_id", companyName);

    const { data, error } = await query;
    if (error) throw error;

    const balances = {};
    for (const row of data || []) {
      const delta = row.type === "inward" ? Number(row.quantity) : -Number(row.quantity);
      balances[row.material_id] = (balances[row.material_id] || 0) + delta;
    }

    const materialIds = Object.keys(balances);
    if (materialIds.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const { data: materials, error: materialError } = await supabase
      .from("materials")
      .select("id, materialName:material_name, materialSize:material_size, materialGSM:material_gsm")
      .in("id", materialIds);
    if (materialError) throw materialError;

    const result = (materials || []).map((m) => ({ material: m, balance: balances[m.id] || 0 }));

    res.status(200).json({ success: true, data: withMongoId(result) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching stock summary: " + error.message });
  }
};
