const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");
const { logImport } = require("../lib/importLog");
const { Readable } = require("stream");
const csv = require("csv-parser");

// §77: the CSV template a bulk-import file must match. Kept as a plain
// array so the download endpoint and any future validation can share
// one source of truth for the expected columns.
const BULK_TEMPLATE_HEADERS = ["name", "contactNumber", "whatsappNumber", "gst", "address"];

const SELECT =
  "id, name, contactNumber:contact_number, whatsappNumber:whatsapp_number, gst, address, creditLimit:credit_limit, status, createdAt:created_at, updatedAt:updated_at, companyName:company_name_id(id, companyName:company_name)";

exports.getVendors = async (req, res) => {
  try {
    const { page, limit, search, status } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("vendors").select(SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });

    if (status) query = query.eq("status", status);
    if (search && String(search).trim()) {
      query = query.ilike("name", `%${String(search).trim()}%`);
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
    res.status(500).json({ success: false, message: "Error fetching vendors: " + error.message });
  }
};

exports.getVendorById = async (req, res) => {
  try {
    const { data, error } = await supabase.from("vendors").select(SELECT).eq("id", req.params.id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching vendor: " + error.message });
  }
};

exports.createVendor = async (req, res) => {
  try {
    const { companyName, name, contactNumber, whatsappNumber, gst, address, creditLimit, status } = req.body;
    if (!companyName || !name || !contactNumber || !whatsappNumber || !address) {
      return res.status(400).json({ success: false, message: "All required fields must be provided" });
    }
    if (!isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid company ID" });
    }
    const { data: companyExists } = await supabase.from("company_names").select("id").eq("id", companyName).maybeSingle();
    if (!companyExists) {
      return res.status(400).json({ success: false, message: "Invalid company" });
    }

    const { data, error } = await supabase
      .from("vendors")
      .insert({
        company_name_id: companyName,
        name,
        contact_number: contactNumber,
        whatsapp_number: whatsappNumber,
        gst: gst || "",
        address,
        credit_limit: creditLimit != null ? Number(creditLimit) : null,
        status: status || "Active",
        created_by: req.user?.id || null,
      })
      .select(SELECT)
      .single();

    if (error) throw error;

    logAudit({ req, action: "create", module: "vendor", recordId: data.id, newValue: data });

    res.status(201).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating vendor: " + error.message });
  }
};

exports.updateVendor = async (req, res) => {
  try {
    const { companyName, name, contactNumber, whatsappNumber, gst, address, creditLimit, status } = req.body;
    if (companyName && !isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid company ID" });
    }
    if (companyName) {
      const { data: companyExists } = await supabase.from("company_names").select("id").eq("id", companyName).maybeSingle();
      if (!companyExists) {
        return res.status(400).json({ success: false, message: "Invalid company" });
      }
    }

    const { data: before } = await supabase.from("vendors").select(SELECT).eq("id", req.params.id).maybeSingle();

    const updateData = {
      ...(companyName && { company_name_id: companyName }),
      ...(name && { name }),
      ...(contactNumber && { contact_number: contactNumber }),
      ...(whatsappNumber && { whatsapp_number: whatsappNumber }),
      ...(gst !== undefined && { gst }),
      ...(address && { address }),
      ...(creditLimit !== undefined && { credit_limit: creditLimit === null ? null : Number(creditLimit) }),
      ...(status !== undefined && { status }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };

    const { data, error } = await supabase
      .from("vendors")
      .update(updateData)
      .eq("id", req.params.id)
      .select(SELECT)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }

    logAudit({ req, action: "update", module: "vendor", recordId: req.params.id, oldValue: before, newValue: data });

    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating vendor: " + error.message });
  }
};

exports.deleteVendor = async (req, res) => {
  try {
    const { data: before } = await supabase.from("vendors").select(SELECT).eq("id", req.params.id).maybeSingle();

    const { data, error } = await supabase.from("vendors").update({ is_delete: true }).eq("id", req.params.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }

    logAudit({ req, action: "delete", module: "vendor", recordId: req.params.id, oldValue: before });

    res.status(200).json({ success: true, message: "Vendor deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting vendor: " + error.message });
  }
};

// §77: downloads a CSV template with just the header row, so an import
// file matches the columns this endpoint actually expects.
exports.downloadVendorTemplate = async (req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="vendor-bulk-import-template.csv"');
  res.status(200).send(BULK_TEMPLATE_HEADERS.join(",") + "\n");
};

exports.bulkCreateVendors = async (req, res) => {
  try {
    const file = req.file;
    const { companyName } = req.body;
    if (!file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }
    if (!companyName || !isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Company name is required and must be valid" });
    }
    const { data: companyExists } = await supabase.from("company_names").select("id").eq("id", companyName).maybeSingle();
    if (!companyExists) {
      return res.status(400).json({ success: false, message: "Invalid company ID" });
    }

    const results = [];
    await new Promise((resolve, reject) => {
      Readable.from(file.buffer)
        .pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", resolve)
        .on("error", reject);
    });

    // §77: previously the first bad row aborted the whole file with one
    // generic message and nothing else in the CSV was imported. Now every
    // row is validated and (if valid) inserted independently, so one bad
    // row doesn't block the rest — the response reports exactly which
    // rows succeeded and which failed, and why.
    const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    const saved = [];
    const errors = [];

    for (let i = 0; i < results.length; i++) {
      const row = results[i];
      const rowNum = i + 2; // header is row 1, first data row is row 2
      const { name, contactNumber, whatsappNumber, gst, address } = row;

      if (!name || !contactNumber || !whatsappNumber || !address) {
        errors.push({ row: rowNum, message: "Missing required field(s): name, contactNumber, whatsappNumber, address" });
        continue;
      }
      if (contactNumber.length !== 10 || !/^[0-9]{10}$/.test(contactNumber)) {
        errors.push({ row: rowNum, message: "Invalid contact number (must be 10 digits)" });
        continue;
      }
      if (whatsappNumber.length !== 10 || !/^[0-9]{10}$/.test(whatsappNumber)) {
        errors.push({ row: rowNum, message: "Invalid WhatsApp number (must be 10 digits)" });
        continue;
      }
      if (gst && !gstRegex.test(gst)) {
        errors.push({ row: rowNum, message: "Invalid GST number format" });
        continue;
      }

      const { data: insertedRow, error: insertErr } = await supabase
        .from("vendors")
        .insert({
          company_name_id: companyName,
          name,
          contact_number: contactNumber,
          whatsapp_number: whatsappNumber,
          gst: gst || "",
          address,
          created_by: req.user?.id || null,
        })
        .select(SELECT)
        .single();

      if (insertErr) {
        errors.push({ row: rowNum, message: insertErr.message });
        continue;
      }
      saved.push(insertedRow);
    }

    await logImport({
      req,
      module: "vendor",
      fileName: file.originalname,
      totalRows: results.length,
      successCount: saved.length,
      failedCount: errors.length,
      errors,
    });

    res.status(200).json({
      success: true,
      message: `Bulk vendor upload finished: ${saved.length} succeeded, ${errors.length} failed`,
      count: saved.length,
      errors,
      data: withMongoId(saved),
    });
  } catch (error) {
    console.error("Error in bulk upload:", error);
    res.status(500).json({ success: false, message: `Server error during bulk upload: ${error.message}` });
  }
};
