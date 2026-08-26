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
  "id, name, contactNumber:contact_number, whatsappNumber:whatsapp_number, gst, address, creditLimit:credit_limit, status, " +
  "pan, bankAccountNumber:bank_account_number, bankIfsc:bank_ifsc, bankName:bank_name, paymentTerms:payment_terms, creditPeriodDays:credit_period_days, vendorCategory:vendor_category, " +
  "createdAt:created_at, updatedAt:updated_at, companyName:company_name_id(id, companyName:company_name)";

exports.getVendors = async (req, res) => {
  try {
    const { page, limit, search, status, companyName } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("vendors").select(SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });

    if (status) query = query.eq("status", status);
    // Mobile/toggle/seed audit (2026-08-26), Phase B: vendors.company_name_id
    // has always existed on this table, but the list endpoint never accepted
    // a companyName filter -- every vendor picker/list in the app was
    // therefore always company-blind. Invalid/omitted companyName falls
    // through to the unfiltered (all-companies) behavior every existing
    // caller already relies on.
    if (companyName && isValidId(companyName)) {
      query = query.eq("company_name_id", companyName);
    }
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
    const { companyName, name, contactNumber, whatsappNumber, gst, address, creditLimit, status, pan, bankAccountNumber, bankIfsc, bankName, paymentTerms, creditPeriodDays, vendorCategory } = req.body;
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
        pan: pan || null,
        bank_account_number: bankAccountNumber || null,
        bank_ifsc: bankIfsc || null,
        bank_name: bankName || null,
        payment_terms: paymentTerms || null,
        credit_period_days: creditPeriodDays != null ? Number(creditPeriodDays) : null,
        vendor_category: vendorCategory || null,
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
    const { companyName, name, contactNumber, whatsappNumber, gst, address, creditLimit, status, pan, bankAccountNumber, bankIfsc, bankName, paymentTerms, creditPeriodDays, vendorCategory } = req.body;
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
      ...(pan !== undefined && { pan }),
      ...(bankAccountNumber !== undefined && { bank_account_number: bankAccountNumber }),
      ...(bankIfsc !== undefined && { bank_ifsc: bankIfsc }),
      ...(bankName !== undefined && { bank_name: bankName }),
      ...(paymentTerms !== undefined && { payment_terms: paymentTerms }),
      ...(creditPeriodDays !== undefined && { credit_period_days: creditPeriodDays === null ? null : Number(creditPeriodDays) }),
      ...(vendorCategory !== undefined && { vendor_category: vendorCategory }),
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

// Module 11 Part B: vendor rate history -- live-computed from purchase
// order lines, the same "no new table" precedent as Stock Ledger/Costing/
// Customer & Vendor Ledger. Every rate a vendor was ever ordered at for a
// material, newest first; optionally narrowed to one material.
exports.getVendorRateHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const { materialId } = req.query;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid vendor ID" });
    }
    if (materialId && !isValidId(materialId)) {
      return res.status(400).json({ success: false, message: "Invalid material ID" });
    }

    const { data: pos, error: poErr } = await supabase
      .from("purchase_orders")
      .select("id, poNumber:po_number, createdAt:created_at, status")
      .eq("vendor_id", id)
      .eq("is_delete", false);
    if (poErr) throw poErr;
    const poIds = (pos || []).map((p) => p.id);
    if (poIds.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }
    const poById = Object.fromEntries((pos || []).map((p) => [p.id, p]));

    let itemQuery = supabase
      .from("purchase_order_items")
      .select("id, purchaseOrderId:purchase_order_id, rate, quantityOrdered:quantity_ordered, createdAt:created_at, material:material_id(id, materialName:material_name)")
      .in("purchase_order_id", poIds);
    if (materialId) itemQuery = itemQuery.eq("material_id", materialId);
    const { data: items, error: itemErr } = await itemQuery;
    if (itemErr) throw itemErr;

    const rows = (items || [])
      .map((item) => ({
        material: item.material,
        rate: item.rate,
        quantityOrdered: item.quantityOrdered,
        purchaseOrder: poById[item.purchaseOrderId] ? { id: poById[item.purchaseOrderId].id, poNumber: poById[item.purchaseOrderId].poNumber, status: poById[item.purchaseOrderId].status } : null,
        orderedAt: poById[item.purchaseOrderId]?.createdAt || item.createdAt,
      }))
      .sort((a, b) => new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime());

    res.status(200).json({ success: true, count: rows.length, data: withMongoId(rows) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching vendor rate history: " + error.message });
  }
};

// Module 11 Part B: vendor on-time-delivery performance -- also
// live-computed, comparing each PO's expected_date against the date of the
// GRN(s) posted against it. A PO with no GRN yet (still Sent) isn't counted
// either way; it isn't a late or on-time delivery until something arrived.
exports.getVendorPerformance = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid vendor ID" });
    }

    const { data: pos, error: poErr } = await supabase
      .from("purchase_orders")
      .select("id, poNumber:po_number, expectedDate:expected_date, status")
      .eq("vendor_id", id)
      .eq("is_delete", false)
      .not("expected_date", "is", null);
    if (poErr) throw poErr;
    const poIds = (pos || []).map((p) => p.id);
    if (poIds.length === 0) {
      return res.status(200).json({ success: true, data: { totalDeliveries: 0, onTimeCount: 0, lateCount: 0, onTimePercentage: null, averageDelayDays: null, deliveries: [] } });
    }

    // Earliest GRN date per PO -- "did the first delivery arrive by the
    // expected date" is the fairest single signal for a PO that may have
    // been received across multiple partial GRNs.
    const { data: grns, error: grnErr } = await supabase
      .from("grns")
      .select("purchaseOrderId:purchase_order_id, receivedDate:received_date")
      .in("purchase_order_id", poIds)
      .eq("is_delete", false)
      .order("received_date", { ascending: true });
    if (grnErr) throw grnErr;

    const firstGrnDateByPo = {};
    for (const g of grns || []) {
      if (!firstGrnDateByPo[g.purchaseOrderId]) firstGrnDateByPo[g.purchaseOrderId] = g.receivedDate;
    }

    const deliveries = [];
    for (const po of pos || []) {
      const firstReceived = firstGrnDateByPo[po.id];
      if (!firstReceived) continue; // nothing received yet -- not a delivery data point
      const delayDays = Math.round((new Date(firstReceived).getTime() - new Date(po.expectedDate).getTime()) / (1000 * 60 * 60 * 24));
      deliveries.push({ poId: po.id, poNumber: po.poNumber, expectedDate: po.expectedDate, firstReceivedDate: firstReceived, delayDays, onTime: delayDays <= 0 });
    }

    const totalDeliveries = deliveries.length;
    const onTimeCount = deliveries.filter((d) => d.onTime).length;
    const lateCount = totalDeliveries - onTimeCount;
    const onTimePercentage = totalDeliveries > 0 ? Math.round((onTimeCount / totalDeliveries) * 1000) / 10 : null;
    const averageDelayDays = totalDeliveries > 0 ? Math.round((deliveries.reduce((sum, d) => sum + Math.max(0, d.delayDays), 0) / totalDeliveries) * 10) / 10 : null;

    res.status(200).json({
      success: true,
      data: { totalDeliveries, onTimeCount, lateCount, onTimePercentage, averageDelayDays, deliveries: withMongoId(deliveries) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching vendor performance: " + error.message });
  }
};
