const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");
const { logImport } = require("../lib/importLog");
const { Readable } = require("stream");
const csv = require("csv-parser");

// §77: the CSV template a bulk-import file must match.
const BULK_TEMPLATE_HEADERS = ["itemName"];

const SELECT = "id, itemName:item_name, status, createdAt:created_at, updatedAt:updated_at, companyName:company_name_id(id, companyName:company_name)";

exports.createProductItem = async (req, res) => {
  try {
    const { itemName, companyName } = req.body;
    // Two-company Phase 1 (claude/two-company-gap-analysis.md): companyName
    // is optional -- omitted/null keeps today's behavior (item visible to
    // every company). isValidId(undefined) is false, so an explicitly-empty
    // value is silently treated the same as "not scoped" rather than a 400.
    if (companyName && isValidId(companyName)) {
      const { data: company } = await supabase.from("company_names").select("id").eq("id", companyName).maybeSingle();
      if (!company) {
        return res.status(400).json({ success: false, message: `Invalid companyName ID: ${companyName}` });
      }
    }
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
      .insert({
        item_name: itemName,
        status: req.body.status || "Active",
        created_by: req.user?.id || null,
        company_name_id: companyName && isValidId(companyName) ? companyName : null,
      })
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
    const { page, limit, search, status, companyName } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase
      .from("product_items")
      .select(SELECT, { count: "exact" })
      .eq("is_delete", false)
      .order("created_at", { ascending: false });

    // Two-company Phase 1 (claude/two-company-gap-analysis.md): a company's
    // Place New Order item picker should see that company's own items plus
    // every unscoped (company_name_id IS NULL) item -- not just an exact
    // match, or every pre-Phase-1 item (all currently NULL) would vanish
    // from every company's list the moment this filter is passed.
    if (companyName && isValidId(companyName)) {
      query = query.or(`company_name_id.is.null,company_name_id.eq.${companyName}`);
    }

    if (status) query = query.eq("status", status);
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
    const { itemName, status, companyName } = req.body;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid product item ID" });
    }
    if (!itemName && status === undefined && companyName === undefined) {
      return res.status(400).json({ success: false, message: "Item name is required" });
    }

    // Two-company Phase 1: companyName undefined leaves the item's current
    // scope untouched; "" or null explicitly un-scopes it back to
    // visible-to-all; a UUID re-scopes it (validated below).
    let companyNameUpdate;
    if (companyName !== undefined) {
      if (!companyName) {
        companyNameUpdate = null;
      } else if (isValidId(companyName)) {
        const { data: company } = await supabase.from("company_names").select("id").eq("id", companyName).maybeSingle();
        if (!company) {
          return res.status(400).json({ success: false, message: `Invalid companyName ID: ${companyName}` });
        }
        companyNameUpdate = companyName;
      } else {
        return res.status(400).json({ success: false, message: `Invalid companyName ID: ${companyName}` });
      }
    }

    const { data, error } = await supabase
      .from("product_items")
      .update({
        ...(itemName && { item_name: itemName }),
        ...(status !== undefined && { status }),
        ...(companyName !== undefined && { company_name_id: companyNameUpdate }),
        updated_at: new Date().toISOString(),
        updated_by: req.user?.id || null,
      })
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

// §77: downloads a CSV template with just the header row, so an import
// file matches the columns this endpoint actually expects.
exports.downloadProductItemTemplate = async (req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="productItem-bulk-import-template.csv"');
  res.status(200).send(BULK_TEMPLATE_HEADERS.join(",") + "\n");
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

    // §77: previously the first bad row aborted the whole file. Now every
    // row is validated and (if valid) inserted independently, so one bad
    // row doesn't block the rest.
    const saved = [];
    const errors = [];

    for (let i = 0; i < results.length; i++) {
      const row = results[i];
      const rowNum = i + 2; // header is row 1, first data row is row 2
      const { itemName } = row;
      if (!itemName) {
        errors.push({ row: rowNum, message: `Missing itemName in row: ${JSON.stringify(row)}` });
        continue;
      }
      const { data: existingItem } = await supabase
        .from("product_items")
        .select("id")
        .ilike("item_name", itemName)
        .eq("is_delete", false)
        .maybeSingle();
      if (existingItem) {
        errors.push({ row: rowNum, message: `Item with name "${itemName}" already exists` });
        continue;
      }

      const { data: insertedItem, error: insertErr } = await supabase
        .from("product_items")
        .insert({ item_name: itemName, created_by: req.user?.id || null })
        .select(SELECT)
        .single();

      if (insertErr) {
        errors.push({ row: rowNum, message: insertErr.message });
        continue;
      }
      saved.push(insertedItem);
    }

    await logImport({
      req,
      module: "productItem",
      fileName: file.originalname,
      totalRows: results.length,
      successCount: saved.length,
      failedCount: errors.length,
      errors,
    });

    res.status(200).json({
      success: true,
      message: `Bulk product item upload finished: ${saved.length} succeeded, ${errors.length} failed`,
      count: saved.length,
      errors,
      data: withMongoId(saved),
    });
  } catch (error) {
    console.error("Error in bulk upload:", error);
    res.status(500).json({ success: false, message: `Server error during bulk upload: ${error.message}` });
  }
};
