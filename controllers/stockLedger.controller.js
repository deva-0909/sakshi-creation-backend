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

// Sakshi Creation order-process audit (2026-08-25): same VALID_CATEGORIES
// widening as inventory.controller.js -- see that file's comment.
const VALID_CATEGORIES = ["printer", "binder", "booklet", "factory", "godown", "designer", "qc", "delivery"];

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
    const { category, companyName, belowReorder } = req.query;
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

    // Build 5 (Quality Manager Dashboard, sub-item 3 -- low-stock alert):
    // reorderLevel already existed on `materials` (Full Figma slide scan
    // Phase 4) and was already surfaced on the Inventory list's In
    // Stock/Low Stock badge -- this just adds the same field (plus a
    // computed belowReorder flag) to the stock summary response so the
    // Quality Manager dashboard can flag materials under threshold without
    // a second round-trip. Purely additive: existing callers that don't
    // read these two new fields are unaffected.
    const { data: materials, error: materialError } = await supabase
      .from("materials")
      .select("id, materialName:material_name, materialSize:material_size, materialGSM:material_gsm, reorderLevel:reorder_level")
      .in("id", materialIds);
    if (materialError) throw materialError;

    let result = (materials || []).map((m) => {
      const balance = balances[m.id] || 0;
      const belowReorderFlag = m.reorderLevel !== null && m.reorderLevel !== undefined && balance < Number(m.reorderLevel);
      return { material: m, balance, belowReorder: belowReorderFlag };
    });

    if (belowReorder === "true") {
      result = result.filter((r) => r.belowReorder);
    }

    res.status(200).json({ success: true, data: withMongoId(result) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching stock summary: " + error.message });
  }
};

// Module 11: On Hand vs Available for a single material. On Hand is the
// same inward-minus-outward balance getMaterialLedger's closing balance
// and getSummary already compute -- nothing new there. Available narrows
// it by active Stock Reservations only; a reservation writes no
// inventories row (see stockMovement.controller.js), so this is the only
// place its effect surfaces.
exports.getAvailability = async (req, res) => {
  try {
    const { materialId } = req.params;
    const { category, warehouse, companyName } = req.query;
    if (!isValidId(materialId)) {
      return res.status(400).json({ success: false, message: "Invalid material ID" });
    }
    if (category && !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: "Invalid category" });
    }

    let invQuery = supabase.from("inventories").select("type, quantity").eq("material_id", materialId).eq("is_delete", false);
    if (category) invQuery = invQuery.eq("category", category);
    if (warehouse) invQuery = invQuery.eq("warehouse_id", warehouse);
    if (companyName) invQuery = invQuery.eq("company_name_id", companyName);
    const { data: invRows, error: invErr } = await invQuery;
    if (invErr) throw invErr;
    const onHand = (invRows || []).reduce((sum, r) => sum + (r.type === "inward" ? Number(r.quantity) : -Number(r.quantity)), 0);

    let resQuery = supabase
      .from("stock_reservations")
      .select("quantity")
      .eq("material_id", materialId)
      .eq("status", "Active")
      .eq("is_delete", false);
    if (category) resQuery = resQuery.eq("category", category);
    if (warehouse) resQuery = resQuery.eq("warehouse_id", warehouse);
    if (companyName) resQuery = resQuery.eq("company_name_id", companyName);
    const { data: resRows, error: resErr } = await resQuery;
    if (resErr) throw resErr;
    const reserved = (resRows || []).reduce((sum, r) => sum + Number(r.quantity), 0);

    res.status(200).json({
      success: true,
      data: { materialId, onHand, reserved, available: onHand - reserved },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching availability: " + error.message });
  }
};
