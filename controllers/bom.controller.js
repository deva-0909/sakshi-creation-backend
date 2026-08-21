const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

const SELECT = `
  id, quantityPerUnit:quantity_per_unit, unit, notes, createdAt:created_at, updatedAt:updated_at,
  productItem:product_item_id(id, itemName:item_name),
  material:material_id(id, materialName:material_name, materialSize:material_size, materialGSM:material_gsm)
`;

exports.createBomLine = async (req, res) => {
  try {
    const { productItem, material, quantityPerUnit, unit, notes } = req.body;
    if (!isValidId(productItem) || !isValidId(material)) {
      return res.status(400).json({ success: false, message: "Invalid ID format for productItem or material" });
    }
    const { data: productItemRow } = await supabase.from("product_items").select("id").eq("id", productItem).eq("is_delete", false).maybeSingle();
    if (!productItemRow) {
      return res.status(404).json({ success: false, message: "Product item not found" });
    }
    const { data: materialRow } = await supabase.from("materials").select("id").eq("id", material).eq("is_delete", false).maybeSingle();
    if (!materialRow) {
      return res.status(404).json({ success: false, message: "Material not found" });
    }
    const { data: existing } = await supabase
      .from("product_boms")
      .select("id")
      .eq("product_item_id", productItem)
      .eq("material_id", material)
      .eq("is_delete", false)
      .maybeSingle();
    if (existing) {
      return res.status(400).json({ success: false, message: "This material is already in the product's recipe" });
    }

    const { data, error } = await supabase
      .from("product_boms")
      .insert({
        product_item_id: productItem,
        material_id: material,
        quantity_per_unit: parseFloat(quantityPerUnit),
        unit: unit || "sheet",
        notes: notes || null,
        created_by: req.user?.id || null,
      })
      .select(SELECT)
      .single();
    if (error) throw error;

    logAudit({ req, action: "create", module: "bom", recordId: data.id, newValue: data });

    res.status(201).json({ success: true, message: "Recipe line added", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error adding recipe line: " + error.message });
  }
};

exports.getBomForProduct = async (req, res) => {
  try {
    const { productItemId } = req.params;
    if (!isValidId(productItemId)) {
      return res.status(400).json({ success: false, message: "Invalid product item ID" });
    }
    const { data, error } = await supabase
      .from("product_boms")
      .select(SELECT)
      .eq("product_item_id", productItemId)
      .eq("is_delete", false)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching recipe: " + error.message });
  }
};

exports.updateBomLine = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid recipe line ID" });
    }
    const { quantityPerUnit, unit, notes } = req.body;
    const updateData = {
      ...(quantityPerUnit !== undefined && { quantity_per_unit: parseFloat(quantityPerUnit) }),
      ...(unit !== undefined && { unit }),
      ...(notes !== undefined && { notes }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };
    const { data, error } = await supabase.from("product_boms").update(updateData).eq("id", id).select(SELECT).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Recipe line not found" });
    }
    logAudit({ req, action: "update", module: "bom", recordId: id, newValue: data });
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating recipe line: " + error.message });
  }
};

exports.deleteBomLine = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid recipe line ID" });
    }
    const { data, error } = await supabase.from("product_boms").update({ is_delete: true }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Recipe line not found" });
    }
    logAudit({ req, action: "delete", module: "bom", recordId: id });
    res.status(200).json({ success: true, message: "Recipe line removed" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error removing recipe line: " + error.message });
  }
};

// Recipe x qty x latest purchase rate per material -- feeds the
// quotation form's live cost estimate. Falls back to null per-line when a
// material has never been purchased (no rate_per_sheet to reference yet),
// so the caller can show "no cost data" for that line rather than a wrong
// number.
exports.estimateCost = async (req, res) => {
  try {
    const { productItemId } = req.params;
    const qty = parseFloat(req.query.qty);
    if (!isValidId(productItemId)) {
      return res.status(400).json({ success: false, message: "Invalid product item ID" });
    }
    if (!qty || qty <= 0) {
      return res.status(400).json({ success: false, message: "A positive qty query parameter is required" });
    }

    const { data: bomLines, error } = await supabase
      .from("product_boms")
      .select("id, quantityPerUnit:quantity_per_unit, unit, material:material_id(id, materialName:material_name)")
      .eq("product_item_id", productItemId)
      .eq("is_delete", false);
    if (error) throw error;

    if (!bomLines.length) {
      return res.status(200).json({ success: true, data: { lines: [], totalCost: null, hasRecipe: false } });
    }

    const lines = await Promise.all(
      bomLines.map(async (line) => {
        const { data: lastPurchase } = await supabase
          .from("purchases")
          .select("rate_per_sheet")
          .eq("material_id", line.material.id)
          .eq("is_delete", false)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const rate = lastPurchase?.rate_per_sheet ?? null;
        const quantityNeeded = line.quantityPerUnit * qty;
        return {
          material: line.material,
          unit: line.unit,
          quantityPerUnit: line.quantityPerUnit,
          quantityNeeded,
          rate,
          lineCost: rate !== null ? Number((rate * quantityNeeded).toFixed(2)) : null,
        };
      })
    );

    const hasAllRates = lines.every((l) => l.lineCost !== null);
    const totalCost = hasAllRates ? Number(lines.reduce((sum, l) => sum + l.lineCost, 0).toFixed(2)) : null;

    res.status(200).json({ success: true, data: { lines, totalCost, hasRecipe: true } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error estimating cost: " + error.message });
  }
};
