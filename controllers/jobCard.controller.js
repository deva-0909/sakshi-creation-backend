const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, deriveInitials, categoryForRole, categoryForStage } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");
const { notifyStatusChange } = require("../lib/notify");

// Phase 2 Part B (two-company): Quality Packaging's production pipeline is
// Printer -> Binder -> Booklet Binder -> Factory -> Godown -- no Designer
// or QC/Delivery stages, per the Figma reference (claude/two-company-gap-
// analysis.md's "Confirmed concrete differences" table). Sakshi Creation's
// pipeline is untouched. Both companies share the same Printer/Binder/
// Booklet Binder stage machinery (machines, job_card_stages rows); Factory
// and Godown reuse the exact same started_at/completed_at + Pending -> In
// Progress -> Done mechanism as an IN/OUT concept, rather than new schema.
const SAKSHI_CREATION_STAGE_ORDER = ["Designer", "Printer", "Binder", "Booklet Binder", "QC", "Delivery"];
const QUALITY_PACKAGING_STAGE_ORDER = ["Printer", "Binder", "Booklet Binder", "Factory", "Godown"];
function stageOrderForCompany(companyName) {
  return companyName === "Quality Packaging" ? QUALITY_PACKAGING_STAGE_ORDER : SAKSHI_CREATION_STAGE_ORDER;
}

const SELECT = `
  id, jobCardNumber:job_card_number, qty, priority, dueDate:due_date, status, currentStage:current_stage,
  createdAt:created_at, updatedAt:updated_at,
  order:order_id!inner(id, orderNumber:order_number, size, companyName:company_name_id(id, companyName:company_name)),
  productItem:product_item_id(id, itemName:item_name),
  assignedTo:assigned_to(id, firstName:first_name, lastName:last_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;
// Build 5 (Quality Manager Dashboard, sub-item 2 -- cartoon/box inventory by
// size): added order.size to the embed above purely so the dashboard can
// group Factory-stage job cards (finished boxes waiting to move to Godown)
// by their order's box size. Purely additive -- every existing caller of
// this SELECT already ignores fields it doesn't ask for.
// order_id and orders.company_name_id are both NOT NULL, so switching the
// order embed above to !inner doesn't drop any rows for existing callers --
// it just makes getAllJobCards' new companyName filter below possible
// (PostgREST requires !inner to filter on an embedded table's columns).

// Spawns a job card from an existing order. The order and its own
// designer/printer/binder/booklet_binder fields are untouched — this is
// an additive, real production ticket that sits alongside it.
exports.createJobCard = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { priority, dueDate } = req.body;
    if (!isValidId(orderId)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }
    const { data: order } = await supabase
      .from("orders")
      .select(
        "id, qty, product_item_id, company_name_id, status, designer_status, printer_status, binder_status, booklet_binder_status, company:company_name_id(company_name)"
      )
      .eq("id", orderId)
      .eq("is_delete", false)
      .maybeSingle();
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    const { data: existingJobCard } = await supabase.from("job_cards").select("id").eq("order_id", orderId).eq("is_delete", false).maybeSingle();
    if (existingJobCard) {
      return res.status(400).json({ success: false, message: "A job card already exists for this order" });
    }

    // Sakshi Creation order-process audit (2026-08-25): SC (unlike Quality
    // Packaging) already has a full legacy production-tracking system --
    // orders.status/designer_status/printer_status/binder_status/
    // booklet_binder_status, driven by the printer-task/binder-task/
    // bookletbinder-task pages. Nothing previously stopped a job card from
    // being spawned for an SC order that's already partway through that
    // legacy flow, which produced two independent, unsynchronized records
    // of the same order's progress -- a real, reachable hazard flagged as
    // the top finding of the SC audit. Block it here: a job card can still
    // be created for a fresh SC order (nothing recorded yet), just not for
    // one legacy tracking has already started on. Quality Packaging has no
    // legacy pages at all, so this check is skipped for it.
    if (order.company?.company_name !== "Quality Packaging") {
      const legacyStageValues = [order.designer_status, order.printer_status, order.binder_status, order.booklet_binder_status];
      const hasLegacyProgress =
        (order.status && !["Received", "Hold"].includes(order.status)) ||
        legacyStageValues.some((s) => s && s !== "Pending");
      if (hasLegacyProgress) {
        return res.status(400).json({
          success: false,
          message:
            "This order is already being tracked through the legacy production pages (Designer/Printer/Binder/Booklet Binder). Creating a job card now would start a second, unsynchronized tracking record for the same order -- continue tracking it through those pages instead.",
        });
      }
    }

    const initials = deriveInitials(order.company?.company_name);
    const initialStage = stageOrderForCompany(order.company?.company_name)[0];

    const { data: jobCardId, error } = await supabase.rpc("create_job_card_transactional", {
      p_order_id: orderId,
      p_product_item_id: order.product_item_id,
      p_qty: order.qty,
      p_priority: priority || "Normal",
      p_due_date: dueDate || null,
      p_created_by: req.user?.id || null,
      p_initials: initials,
      p_initial_stage: initialStage,
    });
    if (error) throw error;

    // QP order-process audit (2026-08-25): Quality Packaging orders have no
    // legacy printer-task/binder-task-style pages driving orders.status --
    // job_cards/job_card_stages is their ONLY production-tracking system, so
    // without this, orders.status stays frozen at "Received" forever no
    // matter how far the job card progresses. Sakshi Creation's orders.status
    // is left completely alone here -- it's still driven by its own legacy
    // pages, same as before this fix; this only fires for Quality Packaging,
    // whose orders.status vocabulary (Printer/Binder/Booklet Binder/Factory/
    // Godown/Completed) was added by the widened orders_status_check
    // migration alongside this change.
    if (order.company?.company_name === "Quality Packaging") {
      await supabase.from("orders").update({ status: initialStage, updated_at: new Date().toISOString() }).eq("id", orderId);
    }

    const { data: populated } = await supabase.from("job_cards").select(SELECT).eq("id", jobCardId).single();

    logAudit({ req, action: "create", module: "jobCard", recordId: jobCardId, newValue: populated });

    res.status(201).json({ success: true, message: "Job card created successfully", data: withMongoId(populated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating job card: " + error.message });
  }
};

exports.getAllJobCards = async (req, res) => {
  try {
    const { status, priority, assignedTo, companyName, currentStage, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("job_cards").select(SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    if (priority) query = query.eq("priority", priority);
    if (assignedTo) query = query.eq("assigned_to", assignedTo);
    // Phase 3 Part B (two-company): the Quality Manager Dashboard filters
    // job cards down to Quality Packaging's own orders and, separately, to
    // a specific pipeline stage (e.g. "Factory" or "Godown" counts). Filters
    // via the !inner order embed above -- job cards have no company_name_id
    // of their own, only their order does.
    // Bug fix (2026-08-27, seed-data verification pass): the SELECT above
    // embeds the joined order under the alias "order" (order:order_id!inner
    // (...)), but this filter referenced "orders.company_name_id" (plural,
    // matching the table name instead of the embed alias). PostgREST filters
    // on an embedded resource by its alias, not by the underlying table
    // name, so this always failed to match and silently returned zero rows
    // whenever a companyName filter was applied -- exactly the symptom seen
    // on the Job Card list page with a company tab selected.
    if (companyName) query = query.eq("order.company_name_id", companyName);
    if (currentStage) query = query.eq("current_stage", currentStage);
    // Multi-role audit fix (Finding 1): authorizeView() attaches this when the
    // caller's role only has view_own (not view_global) for this module.
    if (req.viewOwnFilter) query = query.eq(req.viewOwnFilter.column, req.viewOwnFilter.value);

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
    res.status(500).json({ success: false, message: "Error fetching job cards: " + error.message });
  }
};

exports.getJobCardById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid job card ID" });
    }
    const { data, error } = await supabase.from("job_cards").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Job card not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching job card: " + error.message });
  }
};

exports.updateJobCard = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid job card ID" });
    }
    const { priority, dueDate, assignedTo, status } = req.body;
    const updateData = {
      ...(priority !== undefined && { priority }),
      ...(dueDate !== undefined && { due_date: dueDate }),
      ...(assignedTo !== undefined && { assigned_to: assignedTo }),
      ...(status !== undefined && { status }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };
    const { data, error } = await supabase.from("job_cards").update(updateData).eq("id", id).select(SELECT).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Job card not found" });
    }
    logAudit({ req, action: "update", module: "jobCard", recordId: id, newValue: data });
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating job card: " + error.message });
  }
};

// Advancing a stage writes a real job_card_stages row (the history the
// existing order pipeline never recorded — see the design plan) and
// updates the job card's current_stage marker. This does not touch the
// underlying order's own per-stage fields at all.
exports.advanceStage = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      stage,
      assignedTo,
      status,
      remarks,
      wastedSheet,
      machine,
      completedQty,
      rejectedQty,
      reworkQty,
      qcResult,
      defectCategory,
      defectReason,
      wastageReason,
      wastageMaterial,
      wastageForRole,
      wastageForCompany,
      unitNumber,
      pasteingStatus,
      piningStatus,
      rsFor,
      kantan,
      kantanDeckal,
      factoryDeliveryDate,
    } = req.body;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid job card ID" });
    }
    const { data: jobCard } = await supabase
      .from("job_cards")
      .select("id, current_stage, order_id, order:order_id(company:company_name_id(company_name))")
      .eq("id", id)
      .eq("is_delete", false)
      .maybeSingle();
    if (!jobCard) {
      return res.status(404).json({ success: false, message: "Job card not found" });
    }

    const stageOrder = stageOrderForCompany(jobCard.order?.company?.company_name);
    if (!stageOrder.includes(stage)) {
      return res.status(400).json({ success: false, message: `${stage} is not a stage in this job card's production pipeline` });
    }

    if (machine) {
      // Machines only exist for Printer/Binder/Booklet Binder (see
      // machine.validator.js) -- reject rather than silently drop a
      // machine assigned to a stage that has no equipment of its own.
      if (!["Printer", "Binder", "Booklet Binder"].includes(stage)) {
        return res.status(400).json({ success: false, message: `A machine cannot be assigned to the ${stage} stage` });
      }
      const { data: machineRow } = await supabase.from("machines").select("id, category").eq("id", machine).eq("is_delete", false).maybeSingle();
      if (!machineRow) {
        return res.status(404).json({ success: false, message: "Machine not found" });
      }
      if (machineRow.category !== stage) {
        return res.status(400).json({ success: false, message: `This machine is a ${machineRow.category} machine, not a ${stage} machine` });
      }
    }

    const { data: existingStage } = await supabase
      .from("job_card_stages")
      .select("id, status")
      .eq("job_card_id", id)
      .eq("stage", stage)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const stageUpdate = {
      assigned_to: assignedTo || null,
      status,
      remarks: remarks || null,
      // wasted_sheet is set here as a plain number when no material is
      // named (unchanged legacy behavior); when a material IS named, the
      // wastage RPC below overwrites it atomically along with the
      // material/reason, so a real inventory movement and the stage row
      // never disagree about how much was wasted.
      wasted_sheet: wastedSheet !== undefined ? parseFloat(wastedSheet) : null,
      machine_id: machine || null,
      completed_qty: completedQty !== undefined ? parseFloat(completedQty) : null,
      rejected_qty: rejectedQty !== undefined ? parseFloat(rejectedQty) : null,
      rework_qty: reworkQty !== undefined ? parseFloat(reworkQty) : null,
      qc_result: stage === "QC" ? qcResult || null : null,
      defect_category: stage === "QC" ? defectCategory || null : null,
      defect_reason: stage === "QC" ? defectReason || null : null,
      // QP box-manufacturing Figma audit (2026-08-25): the Order-In
      // screen's expandable Factory checklist (UNIT / START DATE /
      // PASTEING / PINING / RS FOR / KANTAN / KANTAN DECKAL / DELIVERY
      // DATE / STATUS). Gated to the Factory stage the same way the
      // QC-only fields above are gated to QC -- this table already holds
      // one row per (job_card, stage), so Factory's row is where this
      // checklist naturally lives. No formula backs Kantan/Kantan Deckal
      // anywhere in the Figma file either (see claude/qp-box-
      // manufacturing-kantan-figma-audit.md) -- these are plain manual
      // fields, same as the design shows.
      unit_number: stage === "Factory" && unitNumber !== undefined && unitNumber !== null && unitNumber !== "" ? parseInt(unitNumber, 10) : null,
      pasteing_status: stage === "Factory" ? pasteingStatus || null : null,
      pining_status: stage === "Factory" ? piningStatus || null : null,
      rs_for: stage === "Factory" ? rsFor || null : null,
      kantan: stage === "Factory" ? kantan || null : null,
      kantan_deckal: stage === "Factory" ? kantanDeckal || null : null,
      factory_delivery_date: stage === "Factory" ? factoryDeliveryDate || null : null,
      updated_at: new Date().toISOString(),
      ...(status === "Done" && { completed_at: new Date().toISOString() }),
    };

    let stageRow;
    if (existingStage) {
      const { data, error } = await supabase.from("job_card_stages").update(stageUpdate).eq("id", existingStage.id).select("*").single();
      if (error) throw error;
      stageRow = data;
    } else {
      const { data, error } = await supabase
        .from("job_card_stages")
        .insert({ job_card_id: id, stage, started_at: new Date().toISOString(), ...stageUpdate })
        .select("*")
        .single();
      if (error) throw error;
      stageRow = data;
    }

    // Wastage with a named material (Module 8): writes a real `wastage`
    // inventory movement and, in the same transaction, stamps the
    // material/reason onto the stage row -- so the two can never drift
    // apart the way they could if this were two separate calls.
    if (wastedSheet !== undefined && Number(wastedSheet) > 0 && wastageMaterial) {
      const { data: order } = await supabase.from("orders").select("company_name_id").eq("id", jobCard.order_id).maybeSingle();
      const { data: wastageInventoryId, error: wastageError } = await supabase.rpc("record_job_card_wastage_transactional", {
        p_job_card_stage_id: stageRow.id,
        p_material_id: wastageMaterial,
        p_quantity: parseFloat(wastedSheet),
        p_category: categoryForStage(stage),
        p_company_name_id: order?.company_name_id || null,
        p_for_role_id: wastageForRole,
        p_for_company_id: wastageForCompany,
        p_reason: wastageReason || null,
        p_created_by: req.user?.id || null,
        // Full Figma slide scan Phase 4 (Theme 7): so Outward can show which
        // order/job card the wastage belongs to.
        p_job_card_id: id,
        p_order_id: jobCard.order_id,
      });
      if (wastageError) throw wastageError;
      stageRow.wastage_material_id = wastageMaterial;
      stageRow.wastage_reason = wastageReason || null;
      logAudit({ req, action: "create", module: "jobCardWastage", recordId: wastageInventoryId, newValue: { stage: stageRow.id, material: wastageMaterial, quantity: wastedSheet } });
    }

    // The stage marker on job_cards only moves forward when a stage is
    // actually marked Done, so current_stage always reflects work that's
    // genuinely finished rather than whatever was last touched.
    const jobCardUpdate = { updated_at: new Date().toISOString(), updated_by: req.user?.id || null };
    if (status === "Done") {
      const nextIndex = stageOrder.indexOf(stage) + 1;
      jobCardUpdate.current_stage = nextIndex < stageOrder.length ? stageOrder[nextIndex] : "Done";
      if (jobCardUpdate.current_stage === "Done") jobCardUpdate.status = "Completed";
    }
    const { data: updatedJobCard, error: jobCardError } = await supabase.from("job_cards").update(jobCardUpdate).eq("id", id).select(SELECT).single();
    if (jobCardError) throw jobCardError;

    // QP order-process audit (2026-08-25): mirror the job card's own
    // progress onto its parent order's status, Quality Packaging only (see
    // the matching comment in createJobCard above -- Sakshi Creation keeps
    // its existing legacy-page-driven orders.status untouched). Fires only
    // when the job card actually advanced this call (status === "Done"
    // above), so an in-progress/rework update to the *current* stage
    // doesn't move the order backward or send a stale status.
    if (jobCardUpdate.current_stage && jobCard.order?.company?.company_name === "Quality Packaging") {
      const orderStatus = jobCardUpdate.current_stage === "Done" ? "Completed" : jobCardUpdate.current_stage;
      await supabase.from("orders").update({ status: orderStatus, updated_at: new Date().toISOString() }).eq("id", jobCard.order_id);
    }

    logAudit({ req, action: "update", module: "jobCard", recordId: id, newValue: { stage, status } });

    res.status(200).json({ success: true, data: { jobCard: withMongoId(updatedJobCard), stage: withMongoId(stageRow) } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error advancing job card stage: " + error.message });
  }
};

// Records material consumption against a job card and, atomically, writes
// the corresponding outward inventories row (see the "record_job_card_
// material_usage_transactional" migration) -- the mechanism that closes
// the gap where inventory previously only ever tracked material coming
// in from purchases, never going out.
exports.recordMaterialUsage = async (req, res) => {
  try {
    const { id } = req.params;
    const { jobCardStageId, material, bom, quantityUsed, forRole, forCompany } = req.body;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid job card ID" });
    }
    const { data: jobCard } = await supabase.from("job_cards").select("id, order_id").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!jobCard) {
      return res.status(404).json({ success: false, message: "Job card not found" });
    }
    const { data: order } = await supabase.from("orders").select("company_name_id").eq("id", jobCard.order_id).maybeSingle();
    const { data: materialRow } = await supabase.from("materials").select("id").eq("id", material).eq("is_delete", false).maybeSingle();
    if (!materialRow) {
      return res.status(404).json({ success: false, message: "Material not found" });
    }
    const { data: roleRow } = await supabase.from("roles").select("id, role_name").eq("id", forRole).eq("is_delete", false).maybeSingle();
    if (!roleRow) {
      return res.status(404).json({ success: false, message: "Invalid or deleted role ID" });
    }
    if (jobCardStageId) {
      const { data: stageRow } = await supabase.from("job_card_stages").select("id").eq("id", jobCardStageId).eq("job_card_id", id).maybeSingle();
      if (!stageRow) {
        return res.status(400).json({ success: false, message: "jobCardStageId does not belong to this job card" });
      }
    }

    const category = categoryForRole(roleRow.role_name);

    const { data: usageId, error } = await supabase.rpc("record_job_card_material_usage_transactional", {
      p_job_card_id: id,
      p_job_card_stage_id: jobCardStageId || null,
      p_material_id: material,
      p_bom_id: bom || null,
      p_quantity_used: parseFloat(quantityUsed),
      p_category: category,
      p_company_name_id: order?.company_name_id || null,
      p_for_role_id: forRole,
      p_for_company_id: forCompany,
      p_created_by: req.user?.id || null,
      // Full Figma slide scan Phase 4 (Theme 7): so Outward can show which
      // order consumed the material.
      p_order_id: jobCard.order_id,
    });
    if (error) throw error;

    const { data: populated } = await supabase
      .from("job_card_material_usage")
      .select("id, quantityUsed:quantity_used, createdAt:created_at, material:material_id(id, materialName:material_name), inventoryId:inventory_id")
      .eq("id", usageId)
      .single();

    logAudit({ req, action: "create", module: "jobCardMaterialUsage", recordId: usageId, newValue: populated });

    res.status(201).json({ success: true, message: "Material usage recorded", data: withMongoId(populated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error recording material usage: " + error.message });
  }
};

exports.getStageHistory = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid job card ID" });
    }
    const { data, error } = await supabase
      .from("job_card_stages")
      .select(
        `id, stage, status, startedAt:started_at, completedAt:completed_at, remarks,
         wastedSheet:wasted_sheet, wastageReason:wastage_reason,
         wastageMaterial:wastage_material_id(id, materialName:material_name),
         completedQty:completed_qty, rejectedQty:rejected_qty, reworkQty:rework_qty,
         qcResult:qc_result, defectCategory:defect_category, defectReason:defect_reason,
         unitNumber:unit_number, pasteingStatus:pasteing_status, piningStatus:pining_status,
         rsFor:rs_for, kantan, kantanDeckal:kantan_deckal, factoryDeliveryDate:factory_delivery_date,
         assignedTo:assigned_to(id, firstName:first_name, lastName:last_name),
         machine:machine_id(id, machineName:machine_name, machineCode:machine_code)`
      )
      .eq("job_card_id", id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching stage history: " + error.message });
  }
};

// Module 8: aggregates recorded wastage (the material-linked entries from
// advanceStage, see above) by material and by stage over a date range, so
// wastage stops being a number that only ever appears one job card at a
// time. Each material line also carries its BOM's expected_wastage_percent
// where one exists, for reference alongside the actual total -- a true
// weighted actual-vs-plan % would need assumptions about production
// output this report deliberately avoids baking in silently.
exports.getWastageReport = async (req, res) => {
  try {
    const { from, to, materialId, stage, companyName } = req.query;
    let query = supabase
      .from("job_card_stages")
      .select("stage, wastedSheet:wasted_sheet, updatedAt:updated_at, wastageReason:wastage_reason, material:wastage_material_id(id, materialName:material_name), jobCardId:job_card_id")
      .not("wastage_material_id", "is", null)
      .gt("wasted_sheet", 0);
    if (stage) query = query.eq("stage", stage);
    if (materialId) query = query.eq("wastage_material_id", materialId);
    if (from) query = query.gte("updated_at", from);
    if (to) query = query.lte("updated_at", to);

    // Mobile/toggle/seed audit (2026-08-26), Phase C: companyName param
    // added -- previously always mixed both companies' wastage. Neither
    // job_card_stages nor job_cards carries a company column directly, so
    // scope via job_cards -> orders.company_name_id first, then filter this
    // query's job_card_id to that set (a two-step lookup rather than a
    // fragile embedded-relation filter).
    if (companyName) {
      const { data: companyOrders } = await supabase.from("orders").select("id").eq("company_name_id", companyName);
      const orderIds = (companyOrders || []).map((o) => o.id);
      let jobCardIds = [];
      if (orderIds.length) {
        const { data: companyJobCards } = await supabase.from("job_cards").select("id").in("order_id", orderIds);
        jobCardIds = (companyJobCards || []).map((jc) => jc.id);
      }
      query = query.in("job_card_id", jobCardIds.length ? jobCardIds : ["00000000-0000-0000-0000-000000000000"]);
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    const byMaterial = new Map();
    for (const row of rows) {
      const key = row.material?.id;
      if (!key) continue;
      if (!byMaterial.has(key)) {
        byMaterial.set(key, { material: row.material, totalWasted: 0, entries: 0, byStage: {} });
      }
      const bucket = byMaterial.get(key);
      bucket.totalWasted += Number(row.wastedSheet) || 0;
      bucket.entries += 1;
      bucket.byStage[row.stage] = (bucket.byStage[row.stage] || 0) + (Number(row.wastedSheet) || 0);
    }

    const materialIds = [...byMaterial.keys()];
    let expectedByMaterial = {};
    if (materialIds.length) {
      const { data: bomRows } = await supabase
        .from("product_boms")
        .select("materialId:material_id, expectedWastagePercent:expected_wastage_percent")
        .in("material_id", materialIds)
        .eq("is_delete", false)
        .not("expected_wastage_percent", "is", null);
      (bomRows || []).forEach((b) => {
        if (!expectedByMaterial[b.materialId]) expectedByMaterial[b.materialId] = [];
        expectedByMaterial[b.materialId].push(Number(b.expectedWastagePercent));
      });
    }

    const summary = [...byMaterial.values()].map((bucket) => {
      const expected = expectedByMaterial[bucket.material.id];
      return {
        material: bucket.material,
        totalWasted: bucket.totalWasted,
        entries: bucket.entries,
        byStage: bucket.byStage,
        expectedWastagePercent: expected?.length ? Number((expected.reduce((a, b) => a + b, 0) / expected.length).toFixed(2)) : null,
      };
    });

    res.status(200).json({ success: true, data: withMongoId(summary) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error building wastage report: " + error.message });
  }
};

exports.deleteJobCard = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid job card ID" });
    }
    const { data, error } = await supabase.from("job_cards").update({ is_delete: true, status: "Cancelled" }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Job card not found" });
    }
    logAudit({ req, action: "delete", module: "jobCard", recordId: id });
    res.status(200).json({ success: true, message: "Job card cancelled" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error cancelling job card: " + error.message });
  }
};
