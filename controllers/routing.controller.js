// Module 10: Production Routing (scope §13) -- an admin-configurable
// process-stage master and named routing templates. Per the design
// decision this is additive reference only: job_card_stages' hardcoded
// STAGE_ORDER (Designer -> Printer -> Binder -> Booklet Binder -> QC ->
// Delivery) and its CHECK constraint are completely untouched and remain
// the one enforced pipeline. A template is shown on the job card as
// read-only context (see getSuggestedRouting), the same advisory-only
// pattern already used for QC results in Module 8.
const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

const STAGE_SELECT = `
  id, stageName:stage_name, stageOrder:stage_order, description, status,
  createdAt:created_at, updatedAt:updated_at
`;

const TEMPLATE_SELECT = `
  id, templateName:template_name, isDefault:is_default, status, createdAt:created_at, updatedAt:updated_at,
  productItem:product_item_id(id, itemName:item_name),
  stages:routing_template_stages(id, sequenceOrder:sequence_order, processStage:process_stage_id(id, stageName:stage_name, stageOrder:stage_order))
`;

// ---- Process Stages ----

exports.createProcessStage = async (req, res) => {
  try {
    const { stageName, stageOrder, description, status } = req.body;
    const { data: existing } = await supabase.from("process_stages").select("id").ilike("stage_name", stageName).eq("is_delete", false).maybeSingle();
    if (existing) {
      return res.status(400).json({ success: false, message: "A process stage with this name already exists" });
    }
    const { data, error } = await supabase
      .from("process_stages")
      .insert({ stage_name: stageName, stage_order: stageOrder ?? 0, description: description || null, status: status || "Active", created_by: req.user?.id || null })
      .select(STAGE_SELECT)
      .single();
    if (error) throw error;
    logAudit({ req, action: "create", module: "processstage", recordId: data.id, newValue: data });
    res.status(201).json({ success: true, message: "Process stage created successfully", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating process stage: " + error.message });
  }
};

exports.getAllProcessStages = async (req, res) => {
  try {
    const { status } = req.query;
    let query = supabase.from("process_stages").select(STAGE_SELECT).eq("is_delete", false).order("stage_order", { ascending: true });
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching process stages: " + error.message });
  }
};

exports.updateProcessStage = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid process stage ID" });
    }
    const { stageName, stageOrder, description, status } = req.body;
    const updateData = {
      ...(stageName !== undefined && { stage_name: stageName }),
      ...(stageOrder !== undefined && { stage_order: stageOrder }),
      ...(description !== undefined && { description }),
      ...(status !== undefined && { status }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };
    const { data, error } = await supabase.from("process_stages").update(updateData).eq("id", id).select(STAGE_SELECT).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Process stage not found" });
    }
    logAudit({ req, action: "update", module: "processstage", recordId: id, newValue: data });
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating process stage: " + error.message });
  }
};

exports.deleteProcessStage = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid process stage ID" });
    }
    const { data, error } = await supabase.from("process_stages").update({ is_delete: true }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Process stage not found" });
    }
    logAudit({ req, action: "delete", module: "processstage", recordId: id });
    res.status(200).json({ success: true, message: "Process stage deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting process stage: " + error.message });
  }
};

// ---- Routing Templates ----

exports.createRoutingTemplate = async (req, res) => {
  try {
    const { templateName, productItemId, isDefault, stageIds } = req.body;
    if (productItemId && !isValidId(productItemId)) {
      return res.status(400).json({ success: false, message: "Invalid productItemId" });
    }
    if (!Array.isArray(stageIds) || stageIds.length === 0) {
      return res.status(400).json({ success: false, message: "At least one process stage is required" });
    }

    const { data: template, error } = await supabase
      .from("routing_templates")
      .insert({ template_name: templateName, product_item_id: productItemId || null, is_default: Boolean(isDefault), created_by: req.user?.id || null })
      .select("id")
      .single();
    if (error) throw error;

    const rows = stageIds.map((stageId, index) => ({ routing_template_id: template.id, process_stage_id: stageId, sequence_order: index + 1 }));
    const { error: stageErr } = await supabase.from("routing_template_stages").insert(rows);
    if (stageErr) throw stageErr;

    const { data: populated } = await supabase.from("routing_templates").select(TEMPLATE_SELECT).eq("id", template.id).single();
    logAudit({ req, action: "create", module: "routingtemplate", recordId: template.id, newValue: populated });
    res.status(201).json({ success: true, message: "Routing template created successfully", data: withMongoId(populated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating routing template: " + error.message });
  }
};

exports.getAllRoutingTemplates = async (req, res) => {
  try {
    const { productItemId, status } = req.query;
    let query = supabase.from("routing_templates").select(TEMPLATE_SELECT).eq("is_delete", false).order("created_at", { ascending: false });
    if (productItemId) query = query.eq("product_item_id", productItemId);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw error;
    const sorted = (data || []).map((t) => ({ ...t, stages: (t.stages || []).sort((a, b) => a.sequenceOrder - b.sequenceOrder) }));
    res.status(200).json({ success: true, count: sorted.length, data: withMongoId(sorted) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching routing templates: " + error.message });
  }
};

exports.updateRoutingTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid routing template ID" });
    }
    const { templateName, productItemId, isDefault, status, stageIds } = req.body;
    const updateData = {
      ...(templateName !== undefined && { template_name: templateName }),
      ...(productItemId !== undefined && { product_item_id: productItemId || null }),
      ...(isDefault !== undefined && { is_default: Boolean(isDefault) }),
      ...(status !== undefined && { status }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };
    const { data, error } = await supabase.from("routing_templates").update(updateData).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Routing template not found" });
    }

    if (Array.isArray(stageIds)) {
      await supabase.from("routing_template_stages").delete().eq("routing_template_id", id);
      const rows = stageIds.map((stageId, index) => ({ routing_template_id: id, process_stage_id: stageId, sequence_order: index + 1 }));
      if (rows.length) {
        const { error: stageErr } = await supabase.from("routing_template_stages").insert(rows);
        if (stageErr) throw stageErr;
      }
    }

    const { data: populated } = await supabase.from("routing_templates").select(TEMPLATE_SELECT).eq("id", id).single();
    logAudit({ req, action: "update", module: "routingtemplate", recordId: id, newValue: populated });
    res.status(200).json({ success: true, data: withMongoId(populated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating routing template: " + error.message });
  }
};

exports.deleteRoutingTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid routing template ID" });
    }
    const { data, error } = await supabase.from("routing_templates").update({ is_delete: true }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Routing template not found" });
    }
    logAudit({ req, action: "delete", module: "routingtemplate", recordId: id });
    res.status(200).json({ success: true, message: "Routing template deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting routing template: " + error.message });
  }
};

// Read-only helper for the Job Card detail page: the template matching this
// product (if any), else the default template. Purely informational -- the
// job card's actual stage progression is untouched.
exports.getSuggestedRouting = async (req, res) => {
  try {
    const { productItemId } = req.query;
    let template = null;
    if (productItemId) {
      const { data } = await supabase.from("routing_templates").select(TEMPLATE_SELECT).eq("product_item_id", productItemId).eq("is_delete", false).eq("status", "Active").maybeSingle();
      template = data;
    }
    if (!template) {
      const { data } = await supabase.from("routing_templates").select(TEMPLATE_SELECT).eq("is_default", true).eq("is_delete", false).eq("status", "Active").maybeSingle();
      template = data;
    }
    if (template) template.stages = (template.stages || []).sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    res.status(200).json({ success: true, data: template ? withMongoId(template) : null });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching suggested routing: " + error.message });
  }
};
