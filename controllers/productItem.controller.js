const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");
const { Readable } = require("stream");
const csv = require("csv-parser");

const SELECT = "id, itemName:item_name, createdAt:created_at, updatedAt:updated_at";

exports.createProductItem = async (req, res) => {
  try {
    const { itemName } = req.body;
    if (!itemName) {
      return res.status(400).json({ success: false, message: "Item name is required" });
    }

    const { data: existingItem } = await supabase
      .from("product_items")
      .select("id")
      .ilike("item_name", itemName)
      .eq("is_delete", false)
      .maybeSingle();

    if (existingItem) {
      return res.status(409).json({ success: false, message: "Item with this name already exists" });
    }

    const { data, error } = await supabase
      .from("product_items")
      .insert({ item_name: itemName, created_by: req.user?.id || null })
      .select(SELECT)
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, message: "Product item created successfully", data: withMongoId(data) });
  } catch (error) {
    console.error("Error creating product item:", error);
    res.status(500).json({ success: false, message: "Failed to create product item", error: error.message });
  }
};

exports.getAllProductItems = async (req, res) => {
  try {
    const { page, limit, search } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase
      .from("product_items")
      .select(SELECT, { count: "exact" })
      .eq("is_delete", false)
      .order("created_at", { ascending: false });

    if (search && String(search).trim()) {
      query = query.ilike("item_name", `%${String(search).trim()}%`);
    }

    let pageNum, limitNum, from;
    if (paginate) {
      pageNum = parseInt(page, 10) || 1;
      limitNum = parseInt(limit, 10) || 10;
      from = (pageNum - 1) * limitNum;
      const to = from + limitNum - 1;
      query = query.range(from, to);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const response = { success: true, data: withMongoId(data) };
    if (paginate) {
      response.pagination = {
        currentPage: pageNum,
        totalPages: Math.ceil(count / limitNum),
        totalCount: count,
        hasNext: from + data.length < count,
        hasPrev: pageNum > 1,
      };
    }
    res.status(200).json(response);
  } catch (error) {
    console.error("Error fetching product items:", error);
    res.status(500).json({ success: false, message: "Failed to fetch product items", error: error.message });
  }
};

exports.getProductItemById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid product item ID" });
    }

    const { data, error } = await supabase.from("product_items").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Product item not found" });
    }

    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    console.error("Error fetching product item:", error);
    res.status(500).json({ success: false, message: "Failed to fetch product item", error: error.message });
  }
};

exports.updateProductItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { itemName } = req.body;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid product item ID" });
    }
    if (!itemName) {
      return res.status(400).json({ success: false, message: "Item name is required" });
    }

    const { data, error } = await supabase
      .from("product_items")
      .update({ item_name: itemName, updated_at: new Date().toISOString(), updated_by: req.user?.id || null })
      .eq("id", id)
      .select(SELECT)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Product item not found" });
    }

    res.status(200).json({ success: true, message: "Product item updated successfully", data: withMongoId(data) });
  } catch (error) {
    console.error("Error updating product item:", error);
    res.status(500).json({ success: false, message: "Failed to update product item", error: error.message });
  }
};

exports.deleteProductItem = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid product item ID" });
    }

    const { data, error } = await supabase.from("product_items").update({ is_delete: true }).eq("id", id).select(SELECT).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Product item not found" });
    }

    res.status(200).json({ success: true, message: "Product item deleted successfully", data: withMongoId(data) });
  } catch (error) {
    console.error("Error deleting product item:", error);
    res.status(500).json({ success: false, message: "Failed to delete product item", error: error.message });
  }
};

exports.bulkCreateProductItems = async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const results = [];
    await new Promise((resolve, reject) => {
      Readable.from(file.buffer)
        .pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", resolve)
        .on("error", reject);
    });

    const itemNames = [];
    for (const row of results) {
      const { itemName } = row;
      if (!itemName) {
        return res.status(400).json({ success: false, message: `Missing itemName in row: ${JSON.stringify(row)}` });
      }
      const { data: existingItem } = await supabase
        .from("product_items")
        .select("id")
        .ilike("item_name", itemName)
        .eq("is_delete", false)
        .maybeSingle();
      if (existingItem) {
        return res.status(400).json({
          success: false,
          message: `Item with name "${itemName}" already exists in row: ${JSON.stringify(row)}`,
        });
      }
      itemNames.push({ item_name: itemName });
    }

    const { data: saved, error } = await supabase.from("product_items").insert(itemNames).select(SELECT);
    if (error) throw error;

    res.status(200).json({
      success: true,
      message: "Bulk product upload completed successfully",
      count: saved.length,
      data: withMongoId(saved),
    });
  } catch (error) {
    console.error("Error in bulk upload:", error);
    res.status(500).json({ success: false, message: `Server error during bulk upload: ${error.message}` });
  }
};
