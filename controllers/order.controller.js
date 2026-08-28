const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, deriveInitials } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");
const { latestRate } = require("./costing.controller");
const { computeKantanLengthCm, computeEstimatedBoxCost } = require("../lib/boxCalculations");
const { createOrderSchema } = require("../validators/order.validator");

const ORDER_SELECT = `
  id, qty, remarks, filePaths:file_paths, status, orderNumber:order_number, number, size,
  startNumber:start_number, endNumber:end_number, color, pType:p_type, binding, subPaper:sub_paper,
  usedPaper:used_paper, printingrate, gsm, rate, rateType:rate_type,
  designerStatus:designer_status, printerStatus:printer_status, binderStatus:binder_status, bookletBinderStatus:booklet_binder_status,
  printerWastedSheet:printer_wasted_sheet, binderWastedSheet:binder_wasted_sheet, bookletBinderWastedSheet:booklet_binder_wasted_sheet,
  designerRemarks:designer_remarks, printerRemarks:printer_remarks, binderRemarks:binder_remarks, bookletBinderRemarks:booklet_binder_remarks,
  printerPapers:printer_papers, binderPapers:binder_papers, bookletPapers:booklet_papers,
  designFiles:design_files, printerFiles:printer_files, binderFiles:binder_files, bookletBinderFiles:booklet_binder_files,
  ply, deckal,
  isLamination:is_lamination, laminationType:lamination_type, uv, paper1, paper2, numberOfSheetUsed:number_of_sheet_used,
  sheetSize:sheet_size, paperType:paper_type, isPasting:is_pasting, isCutting:is_cutting, isCreasing:is_creasing,
  isFoil:is_foil, isPunching:is_punching, validproof, invoiceValidProof:invoice_valid_proof, reworkHistory:rework_history,
  issuedDate:issued_date, receivedDate:received_date, pagesPerBook:pages_per_book, rateBook:rate_book, totalAmount:total_amount,
  ratePerUnit:rate_per_unit, bindergst, deliveryDate:delivery_date, deliveryTime:delivery_time, isGst:is_gst,
  bookletBinderBinding:booklet_binder_binding, bookletBinderPagesPerBook:booklet_binder_pages_per_book,
  bookletBinderSubPaper:booklet_binder_sub_paper, bookletBinderUsedPaper:booklet_binder_used_paper,
  bookletBinderRateBook:booklet_binder_rate_book, bookletBinderTotalAmount:booklet_binder_total_amount,
  bookletBinderGst:booklet_binder_gst,
  bookletBinderCoveredName:booklet_binder_covered_name, bookletBinderLaminatedName:booklet_binder_laminated_name,
  customerPoNumber:customer_po_number, priority, expectedDeliveryDate:expected_delivery_date,
  orderFrom:order_from, orderDate:order_date, dyeNumber:dye_number, dyeSize:dye_size,
  dyeSheetSize:dye_sheet_size, dyeRemark:dye_remark, godownRemark:godown_remark, factoryRemarks:factory_remarks,
  orderType:order_type,
  deliveryDestination:delivery_destination,
  rawPaperSize:raw_paper_size, rawPaperUsed:raw_paper_used,
  boxLengthCm:box_length_cm, boxWidthCm:box_width_cm, boxHeightCm:box_height_cm,
  kantanLengthCm:kantan_length_cm, estimatedBoxCost:estimated_box_cost,
  paperMaterial:paper_material_id(id, materialName:material_name, materialGSM:material_gsm),
  orderForm:order_form_id(id, orderFormNumber:form_number),
  createdAt:created_at, updatedAt:updated_at,
  companyName:company_name_id(id, companyName:company_name),
  party:party_id(id, partyName:party_name, address, contactPerson:contact_person, personMobileNo:person_mobile_no, personWhatsAppNo:person_whatsapp_no, GSTNo:gst_no),
  productItem:product_item_id(id, itemName:item_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name),
  designer:designer_id(id, firstName:first_name, lastName:last_name),
  printer:printer_id(id, firstName:first_name, lastName:last_name),
  binder:binder_id(id, firstName:first_name, lastName:last_name),
  bookletBinder:booklet_binder_id(id, firstName:first_name, lastName:last_name),
  deliveryStaff:delivery_staff_id(id, firstName:first_name, lastName:last_name)
`;

function processFileList(input) {
  if (!input) return [];
  try {
    const parsed = typeof input === "string" ? JSON.parse(input) : input;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      path: typeof item === "string" ? item : item.path,
      remark: typeof item === "object" ? item.remark || "" : "",
      uploadedAt: new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

exports.createOrder = async (req, res) => {
  try {
    const { companyName, party, productItem, qty, remarks, filePaths, createdBy, isGst, size, rate, rateType, isLamination, laminationType, customerPoNumber, priority, expectedDeliveryDate, ply, deckal, gsm, orderFrom, orderDate, dyeNumber, dyeSize, dyeSheetSize, dyeRemark, godownRemark, factoryRemarks, orderType, deliveryDestination, rawPaperSize, rawPaperUsed, bookletBinderBinding, bookletBinderPagesPerBook, bookletBinderSubPaper, bookletBinderUsedPaper, bookletBinderRateBook, bookletBinderTotalAmount, bookletBinderGst, bookletBinderCoveredName, bookletBinderLaminatedName, boxLengthCm, boxWidthCm, boxHeightCm, paperMaterial } = req.body;

    if (!companyName || !party || !productItem || !qty) {
      return res.status(400).json({ success: false, message: "Company, Party, Product Item, and Quantity are required" });
    }
    if (!isValidId(companyName) || !isValidId(party) || !isValidId(productItem)) {
      return res.status(400).json({ success: false, message: "Invalid ID format" });
    }
    if (rate !== undefined && (isNaN(rate) || rate < 0)) {
      return res.status(400).json({ success: false, message: "Rate must be a non-negative number" });
    }
    if (ply !== undefined && ply !== null && (isNaN(ply) || ply < 0)) {
      return res.status(400).json({ success: false, message: "Ply must be a non-negative number" });
    }
    if (deckal !== undefined && deckal !== null && (isNaN(deckal) || deckal < 0)) {
      return res.status(400).json({ success: false, message: "Deckal must be a non-negative number" });
    }
    if (gsm !== undefined && gsm !== null && (isNaN(gsm) || gsm < 0)) {
      return res.status(400).json({ success: false, message: "GSM must be a non-negative number" });
    }
    if (boxLengthCm !== undefined && boxLengthCm !== null && (isNaN(boxLengthCm) || boxLengthCm < 0)) {
      return res.status(400).json({ success: false, message: "Box Length must be a non-negative number" });
    }
    if (boxWidthCm !== undefined && boxWidthCm !== null && (isNaN(boxWidthCm) || boxWidthCm < 0)) {
      return res.status(400).json({ success: false, message: "Box Width must be a non-negative number" });
    }
    if (boxHeightCm !== undefined && boxHeightCm !== null && (isNaN(boxHeightCm) || boxHeightCm < 0)) {
      return res.status(400).json({ success: false, message: "Box Height must be a non-negative number" });
    }
    if (paperMaterial !== undefined && paperMaterial !== null && !isValidId(paperMaterial)) {
      return res.status(400).json({ success: false, message: "Invalid paperMaterial ID format" });
    }
    if (rateType !== undefined && !["old", "new"].includes(rateType)) {
      return res.status(400).json({ success: false, message: "Rate type must be either 'old' or 'new'" });
    }
    if (isLamination && laminationType && !["Matte", "Gloss"].includes(laminationType)) {
      return res.status(400).json({ success: false, message: "Lamination type must be either 'Matte' or 'Gloss' when lamination is selected" });
    }
    if (priority !== undefined && !["Low", "Normal", "High", "Urgent"].includes(priority)) {
      return res.status(400).json({ success: false, message: "Priority must be one of Low, Normal, High, Urgent" });
    }

    const { data: company } = await supabase.from("company_names").select("id, company_name").eq("id", companyName).maybeSingle();
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }

    // create_order_transactional only checks that party_id satisfies the
    // FK constraint, which a soft-deleted party still does (it's not
    // actually removed) -- so a deleted party could otherwise still be
    // picked for a brand-new order. Reject that here rather than in the
    // RPC, to keep that function's tested transaction untouched.
    const { data: partyRow } = await supabase.from("parties").select("id").eq("id", party).eq("is_delete", false).maybeSingle();
    if (!partyRow) {
      return res.status(404).json({ success: false, message: "Party not found" });
    }

    const initials = deriveInitials(company.company_name);

    // The sequence increment, the order insert, and the party
    // New->Customer promotion all happen inside one Postgres function
    // (see migration "create_order_transactional") — if any step fails,
    // Postgres rolls back all of them together. Previously these were 3
    // separate, unguarded calls: a failure partway (e.g. the party
    // update) could leave an order that exists but whose party was never
    // promoted, with no way to tell from the API response alone.
    const { data: orderId, error } = await supabase.rpc("create_order_transactional", {
      p_company_name_id: companyName,
      p_party_id: party,
      p_product_item_id: productItem,
      p_qty: parseInt(qty, 10),
      p_remarks: remarks || "",
      p_file_paths: processFileList(filePaths),
      p_created_by: createdBy || req.user?.id || null,
      p_initials: initials,
      p_size: size || "",
      p_rate: rate !== undefined ? parseFloat(rate) : null,
      p_rate_type: rateType || null,
      p_is_lamination: isLamination !== undefined ? isLamination : false,
      p_lamination_type: isLamination ? laminationType || "" : "",
      p_is_gst: isGst !== false,
      p_customer_po_number: customerPoNumber || null,
      p_priority: priority || null,
      p_expected_delivery_date: expectedDeliveryDate || null,
    });
    if (error) throw error;

    // Ply/Deckal/GSM (QP box-manufacturing Figma audit, 2026-08-25 + flow
    // trace follow-up) aren't parameters on create_order_transactional --
    // rather than widen that RPC's signature for a few optional fields,
    // they're set with a plain follow-up update when supplied, same as
    // every other genuinely optional order field handled outside the RPC.
    // GSM already existed as a column (set from the SC per-stage pages via
    // updateOrder) but was never collectible on the QP order-intake form
    // the Figma design shows it on -- this closes that specific gap.
    if (ply !== undefined || deckal !== undefined || gsm !== undefined) {
      await supabase
        .from("orders")
        .update({
          ...(ply !== undefined && { ply: ply === null ? null : parseFloat(ply) }),
          ...(deckal !== undefined && { deckal: deckal === null ? null : parseFloat(deckal) }),
          ...(gsm !== undefined && { gsm: gsm === null ? null : parseFloat(gsm) }),
        })
        .eq("id", orderId);
    }

    // Quality Packaging "New Order" Figma match (2026-08-27): Order From,
    // order Date, the DYE number/size/sheet size/remark row, and the
    // Godown/Factory remarks split -- same "optional fields outside the
    // transactional RPC" pattern as ply/deckal/gsm above, since none of
    // these are meaningful for Sakshi Creation's own order flow.
    if (
      orderFrom !== undefined || orderDate !== undefined || dyeNumber !== undefined || dyeSize !== undefined ||
      dyeSheetSize !== undefined || dyeRemark !== undefined || godownRemark !== undefined || factoryRemarks !== undefined
    ) {
      await supabase
        .from("orders")
        .update({
          ...(orderFrom !== undefined && { order_from: orderFrom || null }),
          ...(orderDate !== undefined && { order_date: orderDate || null }),
          ...(dyeNumber !== undefined && { dye_number: dyeNumber || null }),
          ...(dyeSize !== undefined && { dye_size: dyeSize || null }),
          ...(dyeSheetSize !== undefined && { dye_sheet_size: dyeSheetSize || null }),
          ...(dyeRemark !== undefined && { dye_remark: dyeRemark || null }),
          ...(godownRemark !== undefined && { godown_remark: godownRemark || null }),
          ...(factoryRemarks !== undefined && { factory_remarks: factoryRemarks || null }),
        })
        .eq("id", orderId);
    }

    // Binder task-portal Figma restore (2026-08-27): Raw Paper Size / Raw
    // Paper Used, shown on the binder task-portal, printer-task, and
    // binder-detail screens in the design but with no backing column
    // previously -- same "optional field outside the transactional RPC"
    // treatment as the QP fields above.
    if (rawPaperSize !== undefined || rawPaperUsed !== undefined) {
      await supabase
        .from("orders")
        .update({
          ...(rawPaperSize !== undefined && { raw_paper_size: rawPaperSize || null }),
          ...(rawPaperUsed !== undefined && { raw_paper_used: rawPaperUsed || null }),
        })
        .eq("id", orderId);
    }

    // Booklet Binder field-parity fix (Build 2, extended 2026-08-27 with
    // Covered Name/Laminated Name from the Figma Task Details re-audit):
    // Binding/Pages-per-Book/Sub Paper/Used Paper/Rate-per-Book/Total
    // Amount/GST/Covered Name/Laminated Name for the Booklet
    // Binder stage. These deliberately use their own booklet_binder_-
    // prefixed columns rather than Binder's shared binding/pages_per_book/
    // sub_paper/used_paper/rate_book/total_amount/bindergst columns, so the
    // two production stages never silently overwrite each other's data on
    // the same order row -- same "optional field outside the transactional
    // RPC" treatment as the fields above.
    if (
      bookletBinderBinding !== undefined || bookletBinderPagesPerBook !== undefined || bookletBinderSubPaper !== undefined ||
      bookletBinderUsedPaper !== undefined || bookletBinderRateBook !== undefined || bookletBinderTotalAmount !== undefined ||
      bookletBinderGst !== undefined || bookletBinderCoveredName !== undefined || bookletBinderLaminatedName !== undefined
    ) {
      await supabase
        .from("orders")
        .update({
          ...(bookletBinderBinding !== undefined && { booklet_binder_binding: bookletBinderBinding || null }),
          ...(bookletBinderPagesPerBook !== undefined && { booklet_binder_pages_per_book: bookletBinderPagesPerBook === null || bookletBinderPagesPerBook === "" ? null : parseFloat(bookletBinderPagesPerBook) }),
          ...(bookletBinderSubPaper !== undefined && { booklet_binder_sub_paper: bookletBinderSubPaper || null }),
          ...(bookletBinderUsedPaper !== undefined && { booklet_binder_used_paper: bookletBinderUsedPaper || null }),
          ...(bookletBinderRateBook !== undefined && { booklet_binder_rate_book: bookletBinderRateBook === null || bookletBinderRateBook === "" ? null : parseFloat(bookletBinderRateBook) }),
          ...(bookletBinderTotalAmount !== undefined && { booklet_binder_total_amount: bookletBinderTotalAmount === null || bookletBinderTotalAmount === "" ? null : parseFloat(bookletBinderTotalAmount) }),
          ...(bookletBinderGst !== undefined && { booklet_binder_gst: bookletBinderGst === null || bookletBinderGst === "" ? null : parseFloat(bookletBinderGst) }),
          ...(bookletBinderCoveredName !== undefined && { booklet_binder_covered_name: bookletBinderCoveredName || null }),
          ...(bookletBinderLaminatedName !== undefined && { booklet_binder_laminated_name: bookletBinderLaminatedName || null }),
        })
        .eq("id", orderId);
    }

    // Figma frame check follow-up (2026-08-27): Order Type defaults to
    // "New Order" -- the design's own starting state for a freshly placed
    // order -- when the client doesn't send one. Written unconditionally
    // (not gated on `orderType !== undefined`, unlike the optional QP
    // fields above) so every order gets a real starting value rather than
    // staying null forever for anyone who omits it.
    await supabase
      .from("orders")
      .update({ order_type: orderType || "New Order" })
      .eq("id", orderId);

    // QP order-to-factory Figma audit (2026-08-27): Delivery destination
    // (TO CLIENT / SAKSHI OFFICE / TO GODOWN), shown on the Godown "New
    // Order" screen in the design -- confirmed with the user as a real
    // field to build, same "manually set by staff" shape as Order Type
    // above. Defaults to "SAKSHI OFFICE" (the office's own default holding
    // point before an order is routed onward to a client or a godown) when
    // the client doesn't send one -- same unconditional-write-with-default
    // treatment as orderType above, so every order gets a real starting
    // value rather than staying null forever for anyone who omits it.
    await supabase
      .from("orders")
      .update({ delivery_destination: deliveryDestination || "SAKSHI OFFICE" })
      .eq("id", orderId);

    // Box-costing follow-up (2026-08-25 audit, rebuilt as Patch 101 after
    // Patch 89's backend half was found to have never actually landed):
    // Kantan length and estimated box cost, per the two formulas confirmed
    // with the user (see lib/boxCalculations.js). Computed and stored
    // server-side -- never trust a client-supplied kantan/cost value --
    // from box dimensions, gsm, ply (all order-level fields already
    // collected above) and the selected paper material's latest purchase
    // rate. Same "optional fields outside the transactional RPC" pattern
    // as ply/deckal/gsm.
    if (boxLengthCm !== undefined || boxWidthCm !== undefined || boxHeightCm !== undefined || paperMaterial !== undefined) {
      const kantanLengthCm = computeKantanLengthCm({ lengthCm: boxLengthCm, widthCm: boxWidthCm });
      const materialRate = paperMaterial ? await latestRate(paperMaterial) : null;
      const estimatedBoxCost = computeEstimatedBoxCost({
        lengthCm: boxLengthCm,
        widthCm: boxWidthCm,
        heightCm: boxHeightCm,
        gsm,
        ply,
        ratePerSheet: materialRate,
      });
      await supabase
        .from("orders")
        .update({
          ...(boxLengthCm !== undefined && { box_length_cm: boxLengthCm === null ? null : parseFloat(boxLengthCm) }),
          ...(boxWidthCm !== undefined && { box_width_cm: boxWidthCm === null ? null : parseFloat(boxWidthCm) }),
          ...(boxHeightCm !== undefined && { box_height_cm: boxHeightCm === null ? null : parseFloat(boxHeightCm) }),
          ...(paperMaterial !== undefined && { paper_material_id: paperMaterial || null }),
          kantan_length_cm: kantanLengthCm,
          estimated_box_cost: estimatedBoxCost,
        })
        .eq("id", orderId);
    }

    const { data: populatedOrder } = await supabase.from("orders").select(ORDER_SELECT).eq("id", orderId).single();

    res.status(201).json({ success: true, message: "Order created successfully", data: withMongoId(populatedOrder) });
  } catch (error) {
    console.error("Create order error:", error);
    res.status(500).json({ success: false, message: "Failed to create order", error: error.message });
  }
};

// Order Form batch create (Godown Manager Figma audit, Patch 107): the
// Figma "Order Form" concept (e.g. "QP-001") groups several individual
// order rows entered together via one multi-row inline form. Mirrors
// createOrder's own field set and validation but inserts one order_forms
// row plus N linked orders rows, all inside a single Postgres transaction
// (create_order_form_transactional -- same "sequence increment + insert +
// party promotion, all-or-nothing" shape as create_order_transactional
// above, just looped over N rows) so a mid-batch failure can never leave a
// form with only some of its rows persisted, or rows whose numbers were
// consumed but never actually saved.
exports.createOrderForm = async (req, res) => {
  try {
    const { companyName, orders, createdBy } = req.body;

    if (!isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid company ID format" });
    }
    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ success: false, message: "At least one order row is required" });
    }

    const { data: company } = await supabase.from("company_names").select("id, company_name").eq("id", companyName).maybeSingle();
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }

    // Reuse createOrderSchema per row (companyName merged in) rather than
    // re-declaring row-level validation -- same rules the single "Place
    // New Order" dialog already enforces, just applied N times.
    const parsedRows = [];
    for (let i = 0; i < orders.length; i++) {
      const result = createOrderSchema.safeParse({ ...orders[i], companyName });
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: `Row ${i + 1}: ${result.error.issues.map((issue) => issue.message).join(", ")}`,
        });
      }
      const row = result.data;
      if (!isValidId(row.party) || !isValidId(row.productItem)) {
        return res.status(400).json({ success: false, message: `Row ${i + 1}: Invalid Party or Product Item ID` });
      }
      const { data: partyRow } = await supabase.from("parties").select("id, party_tag").eq("id", row.party).eq("is_delete", false).maybeSingle();
      if (!partyRow) {
        return res.status(404).json({ success: false, message: `Row ${i + 1}: Party not found` });
      }
      parsedRows.push({
        party: row.party,
        productItem: row.productItem,
        qty: parseInt(row.qty, 10),
        remarks: row.remarks || "",
        filePaths: processFileList(row.filePaths),
        isGst: row.isGst !== false,
        size: row.size || "",
        rate: row.rate !== undefined ? String(row.rate) : "",
        rateType: row.rateType || "",
        isLamination: row.isLamination !== undefined ? row.isLamination : false,
        laminationType: row.isLamination ? row.laminationType || "" : "",
        customerPoNumber: row.customerPoNumber || "",
        priority: row.priority || "",
        expectedDeliveryDate: row.expectedDeliveryDate || "",
        ply: row.ply !== undefined && row.ply !== null ? String(row.ply) : "",
        deckal: row.deckal !== undefined && row.deckal !== null ? String(row.deckal) : "",
        gsm: row.gsm !== undefined && row.gsm !== null ? String(row.gsm) : "",
        orderFrom: row.orderFrom || "",
        orderDate: row.orderDate || "",
        dyeNumber: row.dyeNumber || "",
        dyeSize: row.dyeSize || "",
        dyeSheetSize: row.dyeSheetSize || "",
        dyeRemark: row.dyeRemark || "",
        godownRemark: row.godownRemark || "",
        factoryRemarks: row.factoryRemarks || "",
        orderType: row.orderType || "",
        deliveryDestination: row.deliveryDestination || "",
      });
    }

    const initials = deriveInitials(company.company_name);

    const { data, error } = await supabase.rpc("create_order_form_transactional", {
      p_company_name_id: companyName,
      p_created_by: createdBy || req.user?.id || null,
      p_initials: initials,
      p_orders: parsedRows,
    });
    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : data;
    const { data: populatedOrders } = await supabase
      .from("orders")
      .select(ORDER_SELECT)
      .eq("order_form_id", result.order_form_id)
      .order("created_at", { ascending: true });

    res.status(201).json({
      success: true,
      message: "Order form created successfully",
      data: {
        orderFormId: result.order_form_id,
        orderFormNumber: result.form_number,
        orders: withMongoId(populatedOrders || []),
      },
    });
  } catch (error) {
    console.error("Create order form error:", error);
    res.status(500).json({ success: false, message: "Failed to create order form", error: error.message });
  }
};

exports.getAllOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, companyName, party, orderFrom } = req.query;
    let query = supabase.from("orders").select(ORDER_SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });

    if (status) query = query.eq("status", status);
    if (companyName && isValidId(companyName)) query = query.eq("company_name_id", companyName);
    if (party && isValidId(party)) query = query.eq("party_id", party);
    // Order To Factory (Godown Manager) page (2026-08-27): server-side
    // equivalent of the client-side ply/deckal filters this same list
    // already supports -- lets that page ask for just GODOWN-originated
    // orders directly instead of fetching everything and filtering in the
    // browser. Optional and additive: omitting it keeps every existing
    // caller's behavior unchanged.
    if (orderFrom) query = query.eq("order_from", orderFrom);
    // Multi-role audit fix (Finding 1): authorizeView() attaches this when the
    // caller's role only has view_own (not view_global) for this module.
    if (req.viewOwnFilter) query = query.eq(req.viewOwnFilter.column, req.viewOwnFilter.value);

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    // Production-tracking-panel Figma audit (2026-08-27): the QP "Order In"
    // list's expandable per-row panel (Unit/Start Date/Pasteing/Pining/Rs
    // For/Kantan/Kantan Deckal/Delivery Date) is the exact same data the
    // Factory job_card_stages row already carries (see the "QP Factory-stage
    // Kantan checklist" fix in claude/qp-box-manufacturing-kantan-figma-
    // audit.md, Patch 66) -- this is a pure surfacing addition, not a new
    // concept. A second, batched lookup (rather than embedding job_cards in
    // ORDER_SELECT itself) keeps this scoped to just this list endpoint and
    // avoids the "fragile embedded-relation filter" pitfall this codebase
    // already avoids elsewhere (see the wastage-report companyName comment
    // above) -- job_card_stages has at most one row per (job_card, stage),
    // so finding the Factory row in JS is simple and cheap at this volume.
    const orderIds = (data || []).map((o) => o.id);
    let jobCardFactoryByOrderId = {};
    if (orderIds.length) {
      const { data: jobCardRows } = await supabase
        .from("job_cards")
        .select(
          `id, orderId:order_id, currentStage:current_stage,
           stages:job_card_stages(stage, status, startedAt:started_at, completedAt:completed_at,
             unitNumber:unit_number, pasteingStatus:pasteing_status, piningStatus:pining_status,
             rsFor:rs_for, kantan, kantanDeckal:kantan_deckal, factoryDeliveryDate:factory_delivery_date)`
        )
        .in("order_id", orderIds)
        .eq("is_delete", false);
      for (const jc of jobCardRows || []) {
        // Patch 112: QP job cards now carry this checklist on their single
        // "Production" stage row, not one literally named "Factory" -- see
        // jobCard.controller.js's stage-simplification comment. Field names
        // below are unaffected, only which row they're read off of.
        const factoryStage = (jc.stages || []).find((s) => s.stage === "Production");
        jobCardFactoryByOrderId[jc.orderId] = {
          jobCardId: jc.id,
          currentStage: jc.currentStage,
          unit: factoryStage?.unitNumber ?? null,
          startDate: factoryStage?.startedAt ?? null,
          pasting: factoryStage?.pasteingStatus ?? null,
          pining: factoryStage?.piningStatus ?? null,
          rsFor: factoryStage?.rsFor ?? null,
          kantan: factoryStage?.kantan ?? null,
          kantanDeckal: factoryStage?.kantanDeckal ?? null,
          finishDate: factoryStage?.factoryDeliveryDate ?? null,
          status: factoryStage?.status ?? null,
        };
      }
    }
    const dataWithProductionPanel = (data || []).map((o) => ({
      ...o,
      productionPanel: jobCardFactoryByOrderId[o.id] || null,
    }));

    res.status(200).json({
      success: true,
      data: withMongoId(dataWithProductionPanel),
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(count / limitNum),
        totalCount: count,
        hasNext: from + data.length < count,
        hasPrev: pageNum > 1,
      },
    });
  } catch (error) {
    console.error("Get all orders error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch orders", error: error.message });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid Order ID" });
    }
    const { data: order, error } = await supabase.from("orders").select(ORDER_SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(order) });
  } catch (error) {
    console.error("Get order by ID error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch order", error: error.message });
  }
};

exports.updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid Order ID" });
    }

    const body = { ...req.body };

    if (body.status === "Delivery" && body.deliveryStaff && body.deliveryDate) {
      const { data: orderGet } = await supabase.from("orders").select("company_name_id, party_id").eq("id", id).maybeSingle();
      if (!orderGet) {
        return res.status(404).json({ success: false, message: "Order not found for assigning delivery task" });
      }
      await supabase.from("assign_tasks").insert({
        date: body.deliveryDate,
        time: body.deliveryTime || "",
        assign_to: body.deliveryStaff,
        company_name_id: orderGet.company_name_id,
        party_name_id: orderGet.party_id,
        reason_for_visit: "Delivery",
        remarks: body.remarks || "",
      });
    }

    if (body.printerWastedSheet !== undefined && (isNaN(body.printerWastedSheet) || body.printerWastedSheet < 0)) {
      return res.status(400).json({ success: false, message: "Printer Wasted Sheet must be a non-negative number" });
    }
    if (body.binderWastedSheet !== undefined && (isNaN(body.binderWastedSheet) || body.binderWastedSheet < 0)) {
      return res.status(400).json({ success: false, message: "Binder Wasted Sheet must be a non-negative number" });
    }
    if (body.bookletBinderWastedSheet !== undefined && (isNaN(body.bookletBinderWastedSheet) || body.bookletBinderWastedSheet < 0)) {
      return res.status(400).json({ success: false, message: "Booklet Binder Wasted Sheet must be a non-negative number" });
    }
    if (body.rate !== undefined && (isNaN(body.rate) || body.rate < 0)) {
      return res.status(400).json({ success: false, message: "Rate must be a non-negative number" });
    }
    if (body.ply !== undefined && body.ply !== null && (isNaN(body.ply) || body.ply < 0)) {
      return res.status(400).json({ success: false, message: "Ply must be a non-negative number" });
    }
    if (body.deckal !== undefined && body.deckal !== null && (isNaN(body.deckal) || body.deckal < 0)) {
      return res.status(400).json({ success: false, message: "Deckal must be a non-negative number" });
    }
    if (body.boxLengthCm !== undefined && body.boxLengthCm !== null && (isNaN(body.boxLengthCm) || body.boxLengthCm < 0)) {
      return res.status(400).json({ success: false, message: "Box Length must be a non-negative number" });
    }
    if (body.boxWidthCm !== undefined && body.boxWidthCm !== null && (isNaN(body.boxWidthCm) || body.boxWidthCm < 0)) {
      return res.status(400).json({ success: false, message: "Box Width must be a non-negative number" });
    }
    if (body.boxHeightCm !== undefined && body.boxHeightCm !== null && (isNaN(body.boxHeightCm) || body.boxHeightCm < 0)) {
      return res.status(400).json({ success: false, message: "Box Height must be a non-negative number" });
    }
    if (body.paperMaterial !== undefined && body.paperMaterial !== null && !isValidId(body.paperMaterial)) {
      return res.status(400).json({ success: false, message: "Invalid paperMaterial ID format" });
    }
    if (body.rateType !== undefined && !["old", "new"].includes(body.rateType)) {
      return res.status(400).json({ success: false, message: "Rate type must be either 'old' or 'new'" });
    }
    if (body.isLamination !== undefined && typeof body.isLamination !== "boolean") {
      return res.status(400).json({ success: false, message: "isLamination must be a boolean" });
    }
    if (body.priority !== undefined && !["Low", "Normal", "High", "Urgent"].includes(body.priority)) {
      return res.status(400).json({ success: false, message: "Priority must be one of Low, Normal, High, Urgent" });
    }

    // Sakshi Creation order-process audit (2026-08-25): the mirror image of
    // the guard in jobCard.controller.js's createJobCard -- once an order
    // has switched to being tracked via a job card, writing to the legacy
    // per-stage fields through this same generic PATCH would silently
    // create a second, disagreeing tracking record again, just from the
    // other direction. Only fires when this update actually touches one of
    // the legacy pipeline fields (untouched updates -- e.g. editing remarks
    // or files -- go through as before, even on a job-carded order).
    const LEGACY_PIPELINE_FIELDS = ["designerStatus", "printerStatus", "binderStatus", "bookletBinderStatus", "designer", "printer", "binder", "bookletBinder"];
    const movesLegacyStatus = body.status !== undefined && !["Received", "Hold"].includes(body.status);
    const touchesLegacyPipeline = LEGACY_PIPELINE_FIELDS.some((f) => body[f] !== undefined) || movesLegacyStatus;
    if (touchesLegacyPipeline) {
      const { data: jobCard } = await supabase.from("job_cards").select("id").eq("order_id", id).eq("is_delete", false).maybeSingle();
      if (jobCard) {
        return res.status(400).json({
          success: false,
          message:
            "This order already has an active job card -- production is being tracked there instead. Advance its stage from the job card rather than the legacy production fields, to avoid two disagreeing tracking records.",
        });
      }
    }

    const patch = {
      ...(body.companyName && { company_name_id: body.companyName }),
      ...(body.party && { party_id: body.party }),
      ...(body.productItem && { product_item_id: body.productItem }),
      ...(body.qty !== undefined && { qty: parseInt(body.qty, 10) }),
      ...(body.remarks !== undefined && { remarks: body.remarks }),
      ...(body.status && { status: body.status }),
      ...(body.size !== undefined && { size: body.size }),
      ...(body.number !== undefined && { number: body.number }),
      ...(body.startNumber !== undefined && { start_number: body.startNumber }),
      ...(body.endNumber !== undefined && { end_number: body.endNumber }),
      ...(body.color !== undefined && { color: body.color }),
      ...(body.pType !== undefined && { p_type: body.pType }),
      ...(body.binding !== undefined && { binding: body.binding }),
      ...(body.subPaper !== undefined && { sub_paper: body.subPaper }),
      ...(body.usedPaper !== undefined && { used_paper: body.usedPaper }),
      ...(body.printingrate !== undefined && { printingrate: body.printingrate }),
      ...(body.gsm !== undefined && { gsm: body.gsm }),
      ...(body.ply !== undefined && { ply: body.ply === null ? null : parseFloat(body.ply) }),
      ...(body.deckal !== undefined && { deckal: body.deckal === null ? null : parseFloat(body.deckal) }),
      ...(body.rate !== undefined && { rate: parseFloat(body.rate) }),
      ...(body.rateType !== undefined && { rate_type: body.rateType }),
      ...(body.designerId && { designer_id: body.designerId }),
      ...(body.designer && { designer_id: body.designer }),
      ...(body.printer && { printer_id: body.printer }),
      ...(body.binder && { binder_id: body.binder }),
      ...(body.bookletBinder && { booklet_binder_id: body.bookletBinder }),
      ...(body.designerStatus && { designer_status: body.designerStatus }),
      ...(body.printerStatus && { printer_status: body.printerStatus }),
      ...(body.binderStatus && { binder_status: body.binderStatus }),
      ...(body.bookletBinderStatus && { booklet_binder_status: body.bookletBinderStatus }),
      ...(body.printerWastedSheet !== undefined && { printer_wasted_sheet: parseInt(body.printerWastedSheet, 10) }),
      ...(body.binderWastedSheet !== undefined && { binder_wasted_sheet: parseInt(body.binderWastedSheet, 10) }),
      ...(body.bookletBinderWastedSheet !== undefined && { booklet_binder_wasted_sheet: parseInt(body.bookletBinderWastedSheet, 10) }),
      ...(body.designerRemarks !== undefined && { designer_remarks: body.designerRemarks }),
      ...(body.printerRemarks !== undefined && { printer_remarks: body.printerRemarks }),
      ...(body.binderRemarks !== undefined && { binder_remarks: body.binderRemarks }),
      ...(body.bookletBinderRemarks !== undefined && { booklet_binder_remarks: body.bookletBinderRemarks }),
      ...(body.printerPapers && Array.isArray(body.printerPapers) && { printer_papers: body.printerPapers }),
      ...(body.binderPapers && Array.isArray(body.binderPapers) && { binder_papers: body.binderPapers }),
      ...(body.bookletPapers && Array.isArray(body.bookletPapers) && { booklet_papers: body.bookletPapers }),
      ...(body.filePaths !== undefined && { file_paths: processFileList(body.filePaths) }),
      ...(body.designFiles !== undefined && { design_files: processFileList(body.designFiles) }),
      ...(body.printerFiles !== undefined && { printer_files: processFileList(body.printerFiles) }),
      ...(body.binderFiles !== undefined && { binder_files: processFileList(body.binderFiles) }),
      ...(body.bookletBinderFiles !== undefined && { booklet_binder_files: processFileList(body.bookletBinderFiles) }),
      ...(body.isLamination !== undefined && { is_lamination: body.isLamination }),
      ...(body.isLamination && body.laminationType && { lamination_type: body.laminationType }),
      ...(body.isLamination === false && { lamination_type: "" }),
      ...(body.uv !== undefined && { uv: body.uv }),
      ...(body.paper1 !== undefined && { paper1: body.paper1 }),
      ...(body.paper2 !== undefined && { paper2: body.paper2 }),
      ...(body.numberOfSheetUsed !== undefined && { number_of_sheet_used: body.numberOfSheetUsed }),
      ...(body.sheetSize !== undefined && { sheet_size: body.sheetSize }),
      ...(body.paperType !== undefined && { paper_type: body.paperType }),
      ...(body.isPasting !== undefined && { is_pasting: body.isPasting }),
      ...(body.isCutting !== undefined && { is_cutting: body.isCutting }),
      ...(body.isCreasing !== undefined && { is_creasing: body.isCreasing }),
      ...(body.isFoil !== undefined && { is_foil: body.isFoil }),
      ...(body.isPunching !== undefined && { is_punching: body.isPunching }),
      ...(body.validproof !== undefined && { validproof: body.validproof }),
      ...(body.invoiceValidProof !== undefined && { invoice_valid_proof: body.invoiceValidProof }),
      ...(body.reworkHistory !== undefined && { rework_history: body.reworkHistory }),
      ...(body.issuedDate !== undefined && { issued_date: body.issuedDate }),
      ...(body.receivedDate !== undefined && { received_date: body.receivedDate }),
      ...(body.pagesPerBook !== undefined && { pages_per_book: body.pagesPerBook }),
      ...(body.rateBook !== undefined && { rate_book: body.rateBook }),
      ...(body.totalAmount !== undefined && { total_amount: body.totalAmount }),
      ...(body.ratePerUnit !== undefined && { rate_per_unit: body.ratePerUnit }),
      ...(body.bindergst !== undefined && { bindergst: body.bindergst }),
      ...(body.bookletBinderBinding !== undefined && { booklet_binder_binding: body.bookletBinderBinding }),
      ...(body.bookletBinderPagesPerBook !== undefined && { booklet_binder_pages_per_book: body.bookletBinderPagesPerBook }),
      ...(body.bookletBinderSubPaper !== undefined && { booklet_binder_sub_paper: body.bookletBinderSubPaper }),
      ...(body.bookletBinderUsedPaper !== undefined && { booklet_binder_used_paper: body.bookletBinderUsedPaper }),
      ...(body.bookletBinderRateBook !== undefined && { booklet_binder_rate_book: body.bookletBinderRateBook }),
      ...(body.bookletBinderTotalAmount !== undefined && { booklet_binder_total_amount: body.bookletBinderTotalAmount }),
      ...(body.bookletBinderGst !== undefined && { booklet_binder_gst: body.bookletBinderGst }),
      ...(body.bookletBinderCoveredName !== undefined && { booklet_binder_covered_name: body.bookletBinderCoveredName }),
      ...(body.bookletBinderLaminatedName !== undefined && { booklet_binder_laminated_name: body.bookletBinderLaminatedName }),
      ...(body.deliveryDate !== undefined && { delivery_date: body.deliveryDate }),
      ...(body.deliveryTime !== undefined && { delivery_time: body.deliveryTime }),
      ...(body.deliveryStaff && { delivery_staff_id: body.deliveryStaff }),
      ...(typeof body.isGst !== "undefined" && { is_gst: body.isGst }),
      ...(body.customerPoNumber !== undefined && { customer_po_number: body.customerPoNumber }),
      ...(body.priority !== undefined && { priority: body.priority }),
      ...(body.expectedDeliveryDate !== undefined && { expected_delivery_date: body.expectedDeliveryDate }),
      ...(body.orderFrom !== undefined && { order_from: body.orderFrom }),
      ...(body.orderDate !== undefined && { order_date: body.orderDate }),
      ...(body.dyeNumber !== undefined && { dye_number: body.dyeNumber }),
      ...(body.dyeSize !== undefined && { dye_size: body.dyeSize }),
      ...(body.dyeSheetSize !== undefined && { dye_sheet_size: body.dyeSheetSize }),
      ...(body.dyeRemark !== undefined && { dye_remark: body.dyeRemark }),
      ...(body.godownRemark !== undefined && { godown_remark: body.godownRemark }),
      ...(body.factoryRemarks !== undefined && { factory_remarks: body.factoryRemarks }),
      ...(body.orderType !== undefined && { order_type: body.orderType }),
      ...(body.deliveryDestination !== undefined && { delivery_destination: body.deliveryDestination }),
      ...(body.rawPaperSize !== undefined && { raw_paper_size: body.rawPaperSize }),
      ...(body.rawPaperUsed !== undefined && { raw_paper_used: body.rawPaperUsed }),
      ...(body.boxLengthCm !== undefined && { box_length_cm: body.boxLengthCm === null ? null : parseFloat(body.boxLengthCm) }),
      ...(body.boxWidthCm !== undefined && { box_width_cm: body.boxWidthCm === null ? null : parseFloat(body.boxWidthCm) }),
      ...(body.boxHeightCm !== undefined && { box_height_cm: body.boxHeightCm === null ? null : parseFloat(body.boxHeightCm) }),
      ...(body.paperMaterial !== undefined && { paper_material_id: body.paperMaterial || null }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };

    // Box-costing follow-up (2026-08-25 audit, rebuilt as Patch 101): Kantan
    // length / estimated box cost recompute whenever any of their inputs
    // change -- box dimensions, gsm, ply, or the paper material -- not just
    // when the box fields themselves are touched, since gsm/ply already had
    // their own update path before this feature existed. Reads whichever
    // inputs weren't part of this request straight off the current row, so
    // e.g. updating just the paper material still recomputes cost using the
    // box's existing dimensions rather than wiping it out. Same "never trust
    // a client-supplied kantan/cost value" rule as createOrder.
    const BOX_COST_INPUT_FIELDS = ["boxLengthCm", "boxWidthCm", "boxHeightCm", "gsm", "ply", "paperMaterial"];
    if (BOX_COST_INPUT_FIELDS.some((f) => body[f] !== undefined)) {
      const { data: currentOrder } = await supabase
        .from("orders")
        .select("box_length_cm, box_width_cm, box_height_cm, gsm, ply, paper_material_id")
        .eq("id", id)
        .maybeSingle();
      const lengthCm = body.boxLengthCm !== undefined ? body.boxLengthCm : currentOrder?.box_length_cm;
      const widthCm = body.boxWidthCm !== undefined ? body.boxWidthCm : currentOrder?.box_width_cm;
      const heightCm = body.boxHeightCm !== undefined ? body.boxHeightCm : currentOrder?.box_height_cm;
      const gsmValue = body.gsm !== undefined ? body.gsm : currentOrder?.gsm;
      const plyValue = body.ply !== undefined ? body.ply : currentOrder?.ply;
      const paperMaterialId = body.paperMaterial !== undefined ? body.paperMaterial : currentOrder?.paper_material_id;

      patch.kantan_length_cm = computeKantanLengthCm({ lengthCm, widthCm });
      const materialRate = paperMaterialId ? await latestRate(paperMaterialId) : null;
      patch.estimated_box_cost = computeEstimatedBoxCost({ lengthCm, widthCm, heightCm, gsm: gsmValue, ply: plyValue, ratePerSheet: materialRate });
    }

    const { data: updated, error } = await supabase.from("orders").update(patch).eq("id", id).select(ORDER_SELECT).maybeSingle();
    if (error) throw error;
    if (!updated) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    res.status(200).json({ success: true, message: "Order updated successfully", data: withMongoId(updated) });
  } catch (error) {
    console.error("Update order error:", error);
    res.status(500).json({ success: false, message: "Failed to update order", error: error.message });
  }
};

exports.deleteOrder = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid Order ID" });
    }
    const { data: order, error } = await supabase.from("orders").update({ is_delete: true }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    const { count } = await supabase.from("orders").select("id", { count: "exact", head: true }).eq("is_delete", false);
    if (count === 0) {
      await supabase.from("sequences").update({ last_sequence: 100 }).eq("type", "global_order");
    }
    res.status(200).json({ success: true, message: "Order deleted successfully", data: { id } });
  } catch (error) {
    console.error("Delete order error:", error);
    res.status(500).json({ success: false, message: "Failed to delete order", error: error.message });
  }
};

exports.getOrdersByCompanyAndParty = async (req, res) => {
  try {
    const { companyId, partyId } = req.params;
    if (!isValidId(companyId) || !isValidId(partyId)) {
      return res.status(400).json({ success: false, message: "Invalid Company ID or Party ID" });
    }
    const { data, error } = await supabase
      .from("orders")
      .select(ORDER_SELECT)
      .eq("company_name_id", companyId)
      .eq("party_id", partyId)
      .eq("is_delete", false)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.status(200).json({ success: true, data: withMongoId(data), count: data.length });
  } catch (error) {
    console.error("Get orders by company and party error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch orders", error: error.message });
  }
};

exports.getDesignerById = async (req, res) => {
  try {
    const { id } = req.user;
    const { data, error } = await supabase.from("orders").select(ORDER_SELECT).eq("designer_id", id).eq("is_delete", false).order("created_at", { ascending: false });
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    console.error("Get orders by designer error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch designer's orders", error: error.message });
  }
};

exports.getPrinterById = async (req, res) => {
  try {
    const { id } = req.user;
    const { data, error } = await supabase.from("orders").select(ORDER_SELECT).eq("printer_id", id).eq("is_delete", false).order("created_at", { ascending: false });
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    console.error("Get orders by printer error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch printer's orders", error: error.message });
  }
};

exports.getBinderById = async (req, res) => {
  try {
    const { id } = req.user;
    const { data, error } = await supabase.from("orders").select(ORDER_SELECT).eq("binder_id", id).eq("is_delete", false).order("created_at", { ascending: false });
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    console.error("Get orders by binder error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch binder's orders", error: error.message });
  }
};

exports.getBookletBinderById = async (req, res) => {
  try {
    const { id } = req.user;
    const { data, error } = await supabase.from("orders").select(ORDER_SELECT).eq("booklet_binder_id", id).eq("is_delete", false).order("created_at", { ascending: false });
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    console.error("Get orders by booklet binder error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch booklet binder's orders", error: error.message });
  }
};

exports.getOrdersByStaffId = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid staff ID format" });
    }
    const { data: staff } = await supabase.from("staff").select("id").eq("id", id).maybeSingle();
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff member not found" });
    }
    const { data, error } = await supabase.from("orders").select(ORDER_SELECT).eq("created_by", id).eq("is_delete", false).order("created_at", { ascending: false });
    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(200).json({ success: true, message: "No orders found for this staff member", count: 0, data: [] });
    }
    res.status(200).json({ success: true, message: "Orders retrieved successfully", count: data.length, data: withMongoId(data) });
  } catch (error) {
    console.error("Error fetching orders by staff ID:", error);
    res.status(500).json({ success: false, message: "Failed to fetch orders", error: error.message });
  }
};

exports.updateStaffStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { statusType, status } = req.body;
    if (!isValidId(orderId)) {
      return res.status(400).json({ success: false, message: "Invalid Order ID" });
    }
    const validStatusTypes = ["printer", "binder", "bookletBinder"];
    const validStatusValues = ["Pending", "In Progress", "Done"];
    if (!validStatusTypes.includes(statusType)) {
      return res.status(400).json({ success: false, message: "Invalid status type" });
    }
    if (!validStatusValues.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status value" });
    }

    const columnMap = { printer: "printer_status", binder: "binder_status", bookletBinder: "booklet_binder_status" };
    const column = columnMap[statusType];

    // Sakshi Creation order-process audit (2026-08-25): same dual-tracking
    // guard as updateOrder above -- this endpoint is the other real write
    // path onto the legacy per-stage fields (used by the printer-task/
    // binder-task/bookletbinder-task pages), so it needs the same check.
    const { data: existingJobCard } = await supabase.from("job_cards").select("id").eq("order_id", orderId).eq("is_delete", false).maybeSingle();
    if (existingJobCard) {
      return res.status(400).json({
        success: false,
        message:
          "This order already has an active job card -- production is being tracked there instead. Advance its stage from the job card rather than the legacy production fields, to avoid two disagreeing tracking records.",
      });
    }

    const { data: before } = await supabase.from("orders").select(column).eq("id", orderId).maybeSingle();

    const { data: updatedOrder, error } = await supabase
      .from("orders")
      .update({ [column]: status, updated_at: new Date().toISOString() })
      .eq("id", orderId)
      .select(ORDER_SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!updatedOrder) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    logAudit({
      req,
      action: "status_change",
      module: "order",
      recordId: orderId,
      oldValue: before ? { [column]: before[column] } : null,
      newValue: { [column]: status },
    });

    res.status(200).json({ success: true, message: `${statusType} status updated successfully`, data: withMongoId(updatedOrder) });
  } catch (error) {
    console.error("Update staff status error:", error);
    res.status(500).json({ success: false, message: "Failed to update status", error: error.message });
  }
};
