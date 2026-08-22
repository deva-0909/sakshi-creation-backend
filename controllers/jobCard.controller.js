const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, deriveInitials, categoryForRole } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

const SELECT = `
  id, jobCardNumber:job_card_number, qty, priority, dueDate:due_date, status, currentStage:current_stage,
  createdAt:created_at, updatedAt:updated_at,
  order:order_id(id, orderNumber:order_number),
  productItem:product_item_id(id, itemName:item_name),
  assignedTo:assigned_to(id, firstName:first_name, lastName:last_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

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
      .select("id, qty, product_item_id, company_name_id, company:company_name_id(company_name)")
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

    const initials = deriveInitials(order.company?.company_name);

    const { data: jobCardId, error } = await supabase.rpc("create_job_card_transactional", {
      p_order_id: orderId,
      p_product_item_id: order.product_item_id,
      p_qty: order.qty,
      p_priority: priority || "Normal",
      p_due_date: dueDate || null,
      p_created_by: req.user?.id || null,
      p_initials: initials,
    });
    if (error) throw error;

    const { data: populated } = await supabase.from("job_cards").select(SELECT).eq("id", jobCardId).single();

    logAudit({ req, action: "create", module: "jobCard", recordId: jobCardId, newValue: populated });

    res.status(201).json({ success: true, message: "Job card created successfully", data: withMongoId(populated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating job card: " + error.message });
  }
};

exports.getAllJobCards = async (req, res) => {
  try {
    const { status, priority, assignedTo, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("job_cards").select(SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    if (priority) query = query.eq("priority", priority);
    if (assignedTo) query = query.eq("assigned_to", assignedTo);

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
    const { stage, assignedTo, status, remarks, wastedSheet, machine } = req.body;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid job card ID" });
    }
    const { data: jobCard } = await supabase.from("job_cards").select("id, current_stage").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!jobCard) {
      return res.status(404).json({ success: false, message: "Job card not found" });
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
      wasted_sheet: wastedSheet !== undefined ? parseFloat(wastedSheet) : null,
      machine_id: machine || null,
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

    // The stage marker on job_cards only moves forward when a stage is
    // actually marked Done, so current_stage always reflects work that's
    // genuinely finished rather than whatever was last touched.
    const jobCardUpdate = { updated_at: new Date().toISOString(), updated_by: req.user?.id || null };
    if (status === "Done") {
      const STAGE_ORDER = ["Designer", "Printer", "Binder", "Booklet Binder", "Delivery"];
      const nextIndex = STAGE_ORDER.indexOf(stage) + 1;
      jobCardUpdate.current_stage = nextIndex < STAGE_ORDER.length ? STAGE_ORDER[nextIndex] : "Done";
      if (jobCardUpdate.current_stage === "Done") jobCardUpdate.status = "Completed";
    }
    const { data: updatedJobCard, error: jobCardError } = await supabase.from("job_cards").update(jobCardUpdate).eq("id", id).select(SELECT).single();
    if (jobCardError) throw jobCardError;

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
        "id, stage, status, startedAt:started_at, completedAt:completed_at, remarks, wastedSheet:wasted_sheet, assignedTo:assigned_to(id, firstName:first_name, lastName:last_name), machine:machine_id(id, machineName:machine_name, machineCode:machine_code)"
      )
      .eq("job_card_id", id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching stage history: " + error.message });
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
