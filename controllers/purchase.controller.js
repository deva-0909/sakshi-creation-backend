const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, categoryForRole } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");
const { logImport } = require("../lib/importLog");
const { Readable } = require("stream");
const csv = require("csv-parser");

// §77: the CSV template a bulk-import file must match. The vendor,
// company, role, staff and material are supplied once for the whole
// file (via the form fields alongside the upload), so the per-row CSV
// only needs the per-purchase columns.
const BULK_TEMPLATE_HEADERS = ["billNumber", "quantity", "ratePerSheet", "kg"];

const SELECT = `
  id, billNumber:bill_number, quantity, ratePerSheet:rate_per_sheet, kg, createdAt:created_at,
  vendorName:vendor_name_id(id, name),
  material:material_id(id, materialName:material_name, materialSize:material_size, materialGSM:material_gsm),
  companyName:company_name_id(id, companyName:company_name),
  for:for_role_id(id, roleName:role_name),
  forCompany:for_company_id(id, firstName:first_name, lastName:last_name)
`;

exports.getCompanies = async (req, res) => {
  try {
    const { data, error } = await supabase.from("company_names").select("id, companyName:company_name");
    if (error) throw error;
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching companies: " + error.message });
  }
};

exports.getRoles = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("roles")
      .select("id, roleName:role_name")
      .eq("is_delete", false);
    if (error) throw error;
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching roles: " + error.message });
  }
};

exports.getStaffByRole = async (req, res) => {
  try {
    const { roleId } = req.params;
    if (!isValidId(roleId)) {
      return res.status(400).json({ success: false, message: "Invalid role ID format" });
    }
    const { data: role } = await supabase.from("roles").select("id, is_delete").eq("id", roleId).maybeSingle();
    if (!role || role.is_delete) {
      return res.status(404).json({ success: false, message: "Role not found or has been deleted" });
    }
    const { data, error } = await supabase
      .from("staff")
      .select("id, firstName:first_name, lastName:last_name")
      .eq("role_id", roleId)
      .eq("status", true);
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching staff: " + error.message });
  }
};

async function createInventoryForPurchase(purchase, roleName) {
  const category = categoryForRole(roleName);
  await supabase.from("inventories").insert({
    category,
    type: "inward",
    material_id: purchase.material_id,
    quantity: purchase.quantity,
    kg: purchase.kg,
    vendor_id: purchase.vendor_name_id,
    date: new Date().toISOString().slice(0, 10),
    purchase_id: purchase.id,
    company_name_id: purchase.company_name_id,
    for_role_id: purchase.for_role_id,
    for_company_id: purchase.for_company_id,
  });
}

exports.createPurchase = async (req, res) => {
  try {
    const { vendorName, billNumber, material, quantity, ratePerSheet, kg, companyName, for: role, forCompany: staff } = req.body;

    if (!vendorName || !billNumber || !material || !quantity || !ratePerSheet || !kg || !companyName || !role || !staff) {
      return res.status(400).json({ success: false, message: "All required fields must be provided" });
    }

    const { data: existingPurchase } = await supabase
      .from("purchases")
      .select("id")
      .eq("bill_number", billNumber)
      .maybeSingle();
    if (existingPurchase) {
      return res.status(400).json({ success: false, message: "Bill number must be unique" });
    }

    const { data: vendorExists } = await supabase.from("vendors").select("id").eq("id", vendorName).maybeSingle();
    if (!vendorExists) {
      return res.status(400).json({ success: false, message: "Invalid vendor" });
    }
    const { data: companyExists } = await supabase.from("company_names").select("id").eq("id", companyName).maybeSingle();
    if (!companyExists) {
      return res.status(400).json({ success: false, message: "Invalid company" });
    }
    const { data: roleExists } = await supabase.from("roles").select("id, role_name").eq("id", role).eq("is_delete", false).maybeSingle();
    if (!roleExists) {
      return res.status(400).json({ success: false, message: "Invalid or deleted role" });
    }
    const { data: staffExists } = await supabase.from("staff").select("id").eq("id", staff).eq("role_id", role).eq("status", true).maybeSingle();
    if (!staffExists) {
      return res.status(400).json({ success: false, message: "Invalid staff or staff-role mismatch" });
    }
    const { data: materialExists } = await supabase.from("materials").select("id").eq("id", material).maybeSingle();
    if (!materialExists) {
      return res.status(400).json({ success: false, message: "Invalid material" });
    }

    const { data: savedPurchase, error } = await supabase
      .from("purchases")
      .insert({
        vendor_name_id: vendorName,
        bill_number: billNumber,
        material_id: material,
        quantity,
        rate_per_sheet: ratePerSheet,
        kg,
        company_name_id: companyName,
        for_role_id: role,
        for_company_id: staff,
        created_by: req.user?.id || null,
      })
      .select("*")
      .single();

    if (error) throw error;

    await createInventoryForPurchase(savedPurchase, roleExists.role_name);

    const { data: populated } = await supabase.from("purchases").select(SELECT).eq("id", savedPurchase.id).single();

    logAudit({ req, action: "create", module: "purchase", recordId: savedPurchase.id, newValue: populated });

    res.status(201).json({ success: true, data: withMongoId(populated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating purchase: " + error.message });
  }
};

exports.getAllPurchases = async (req, res) => {
  try {
    const { page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    // No single obvious text column to search across (vendor/material are
    // FK-joined, not local columns) — pagination only, no search param.
    let query = supabase
      .from("purchases")
      .select(SELECT, { count: "exact" })
      .eq("is_delete", false)
      .order("created_at", { ascending: false });

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

    const response = { success: true, count: data.length, data: withMongoId(data) };
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
    res.status(500).json({ success: false, message: "Error fetching purchases: " + error.message });
  }
};

exports.getPurchaseById = async (req, res) => {
  try {
    const { data, error } = await supabase.from("purchases").select(SELECT).eq("id", req.params.id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Purchase not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching purchase: " + error.message });
  }
};

exports.updatePurchase = async (req, res) => {
  try {
    const { vendorName, billNumber, material, quantity, ratePerSheet, kg, companyName, for: role, forCompany: staff } = req.body;

    if (billNumber) {
      const { data: existingPurchase } = await supabase
        .from("purchases")
        .select("id")
        .eq("bill_number", billNumber)
        .neq("id", req.params.id)
        .maybeSingle();
      if (existingPurchase) {
        return res.status(400).json({ success: false, message: "Bill number must be unique" });
      }
    }

    const { data: before } = await supabase.from("purchases").select(SELECT).eq("id", req.params.id).maybeSingle();

    const updateData = {
      ...(vendorName && { vendor_name_id: vendorName }),
      ...(billNumber && { bill_number: billNumber }),
      ...(material && { material_id: material }),
      ...(quantity !== undefined && { quantity }),
      ...(ratePerSheet !== undefined && { rate_per_sheet: ratePerSheet }),
      ...(kg !== undefined && { kg }),
      ...(companyName && { company_name_id: companyName }),
      ...(role && { for_role_id: role }),
      ...(staff && { for_company_id: staff }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };

    const { data: updatedPurchase, error } = await supabase
      .from("purchases")
      .update(updateData)
      .eq("id", req.params.id)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!updatedPurchase) {
      return res.status(404).json({ success: false, message: "Purchase not found" });
    }

    const { data: roleExists } = await supabase
      .from("roles")
      .select("role_name")
      .eq("id", role || updatedPurchase.for_role_id)
      .maybeSingle();

    const { data: existingInventory } = await supabase
      .from("inventories")
      .select("id")
      .eq("purchase_id", req.params.id)
      .eq("is_delete", false)
      .maybeSingle();

    if (existingInventory) {
      await supabase
        .from("inventories")
        .update({
          category: categoryForRole(roleExists?.role_name),
          type: "inward",
          material_id: updatedPurchase.material_id,
          quantity: updatedPurchase.quantity,
          kg: updatedPurchase.kg,
          vendor_id: updatedPurchase.vendor_name_id,
          date: new Date().toISOString().slice(0, 10),
          company_name_id: updatedPurchase.company_name_id,
          for_role_id: updatedPurchase.for_role_id,
          for_company_id: updatedPurchase.for_company_id,
        })
        .eq("id", existingInventory.id);
    } else {
      await createInventoryForPurchase(updatedPurchase, roleExists?.role_name);
    }

    const { data: populated } = await supabase.from("purchases").select(SELECT).eq("id", updatedPurchase.id).single();

    logAudit({ req, action: "update", module: "purchase", recordId: req.params.id, oldValue: before, newValue: populated });

    res.status(200).json({ success: true, data: withMongoId(populated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating purchase: " + error.message });
  }
};

exports.deletePurchase = async (req, res) => {
  try {
    const { data: before } = await supabase.from("purchases").select(SELECT).eq("id", req.params.id).maybeSingle();

    const { data, error } = await supabase.from("purchases").update({ is_delete: true }).eq("id", req.params.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Purchase not found" });
    }
    await supabase.from("inventories").update({ is_delete: true }).eq("purchase_id", req.params.id);

    logAudit({ req, action: "delete", module: "purchase", recordId: req.params.id, oldValue: before });

    res.status(200).json({ success: true, message: "Purchase deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting purchase: " + error.message });
  }
};

exports.getPurchasesByMaterial = async (req, res) => {
  try {
    if (!isValidId(req.params.materialId)) {
      return res.status(400).json({ success: false, message: "Invalid material ID" });
    }
    const { data, error } = await supabase.from("purchases").select(SELECT).eq("material_id", req.params.materialId).eq("is_delete", false);
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching purchases by material: " + error.message });
  }
};

exports.getPurchasesByCompany = async (req, res) => {
  try {
    if (!isValidId(req.params.companyId)) {
      return res.status(400).json({ success: false, message: "Invalid company ID" });
    }
    const { data, error } = await supabase.from("purchases").select(SELECT).eq("company_name_id", req.params.companyId).eq("is_delete", false);
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching purchases by company: " + error.message });
  }
};

exports.getPurchasesByDateRange = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: "Start date and end date are required" });
    }
    const { data, error } = await supabase
      .from("purchases")
      .select(SELECT)
      .eq("is_delete", false)
      .gte("created_at", new Date(startDate).toISOString())
      .lte("created_at", new Date(endDate).toISOString())
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching purchases by date range: " + error.message });
  }
};

// §77: downloads a CSV template with just the header row, so an import
// file matches the columns this endpoint actually expects.
exports.downloadPurchaseTemplate = async (req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="purchase-bulk-import-template.csv"');
  res.status(200).send(BULK_TEMPLATE_HEADERS.join(",") + "\n");
};

exports.bulkCreatePurchases = async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const { vendorName, companyName, for: role, forCompany: staff, materialName, materialGSM, materialSize } = req.body;
    if (!vendorName || !companyName || !role || !staff || !materialName || !materialGSM || !materialSize) {
      return res.status(400).json({ success: false, message: "All required fields must be provided" });
    }

    const { data: vendorExists } = await supabase.from("vendors").select("id").eq("id", vendorName).maybeSingle();
    if (!vendorExists) {
      return res.status(400).json({ success: false, message: `Invalid vendor ID: ${vendorName}` });
    }
    const { data: companyExists } = await supabase.from("company_names").select("id").eq("id", companyName).maybeSingle();
    if (!companyExists) {
      return res.status(400).json({ success: false, message: `Invalid company ID: ${companyName}` });
    }
    const { data: roleExists } = await supabase.from("roles").select("id, role_name").eq("id", role).eq("is_delete", false).maybeSingle();
    if (!roleExists) {
      return res.status(400).json({ success: false, message: `Invalid or deleted role ID: ${role}` });
    }
    const { data: staffExists } = await supabase.from("staff").select("id").eq("id", staff).eq("role_id", role).eq("status", true).maybeSingle();
    if (!staffExists) {
      return res.status(400).json({ success: false, message: `Invalid staff ID or staff-role mismatch: ${staff}` });
    }
    const { data: material } = await supabase
      .from("materials")
      .select("id")
      .eq("material_name", materialName)
      .eq("material_gsm", Number(materialGSM))
      .eq("material_size", materialSize)
      .maybeSingle();
    if (!material) {
      return res.status(400).json({
        success: false,
        message: `Invalid material: Name=${materialName}, GSM=${materialGSM}, Size=${materialSize}`,
      });
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
      const { billNumber, quantity, ratePerSheet, kg } = row;
      if (!billNumber || !quantity || !ratePerSheet || !kg) {
        errors.push({ row: rowNum, message: `Missing required fields in row: ${JSON.stringify(row)}` });
        continue;
      }
      const { data: existingPurchase } = await supabase.from("purchases").select("id").eq("bill_number", billNumber).maybeSingle();
      if (existingPurchase) {
        errors.push({ row: rowNum, message: `Duplicate bill number: ${billNumber}` });
        continue;
      }

      const { data: insertedPurchase, error: insertErr } = await supabase
        .from("purchases")
        .insert({
          vendor_name_id: vendorName,
          bill_number: billNumber,
          material_id: material.id,
          quantity: Number(quantity),
          rate_per_sheet: Number(ratePerSheet),
          kg: Number(kg),
          company_name_id: companyName,
          for_role_id: role,
          for_company_id: staff,
          created_by: req.user?.id || null,
        })
        .select("*")
        .single();

      if (insertErr) {
        errors.push({ row: rowNum, message: insertErr.message });
        continue;
      }

      // Same fire-and-forget behavior as the single-purchase create/update
      // endpoints: the derived inventory row is best-effort and doesn't
      // block or roll back the purchase itself.
      await createInventoryForPurchase(insertedPurchase, roleExists.role_name);
      saved.push(insertedPurchase);
    }

    const { data: populated } = saved.length
      ? await supabase.from("purchases").select(SELECT).in("id", saved.map((p) => p.id))
      : { data: [] };

    await logImport({
      req,
      module: "purchase",
      fileName: file.originalname,
      totalRows: results.length,
      successCount: saved.length,
      failedCount: errors.length,
      errors,
    });

    res.status(200).json({
      success: true,
      message: `Bulk purchase upload finished: ${saved.length} succeeded, ${errors.length} failed`,
      count: saved.length,
      errors,
      data: withMongoId(populated),
    });
  } catch (error) {
    console.error("Error in bulk upload:", error);
    res.status(500).json({ success: false, message: `Server error during bulk upload: ${error.message}` });
  }
};
