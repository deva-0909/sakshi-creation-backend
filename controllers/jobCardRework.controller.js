// Module 8: Rework as its own structured, audited, approval-gated record
// -- instead of the free-text note previously buried in only the
// Designer stage's remarks (see the design plan). Mirrors the
// ALLOWED_TRANSITIONS + transition() pattern already used by
// Quotation/Purchase Order/Invoice, including the same "Pending Approval"
// notification hook via notifyStatusChange -- so an approver sees a new
// rework the same way they'd see a quotation waiting on them.
const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");
const { notifyStatusChange } = require("../lib/notify");

const SELECT = `
  id, reason, defectCategory:defect_category, quantity, responsibleDepartment:responsible_department,
  additionalMaterialNotes:additional_material_notes, cost, status,
  approvedAt:approved_at, createdAt:created_at, updatedAt:updated_at,
  jobCardStage:job_card_stage_id(id, stage),
  responsibleStaff:responsible_staff_id(id, firstName:first_name, lastName:last_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name),
  approvedBy:approved_by(id, firstName:first_name, lastName:last_name)
`;

const ALLOWED_TRANSITIONS = {
  Pending: ["In Progress"],
  "In Progress": ["Pending Approval"],
  "Pending Approval": ["Approved", "Rejected"],
  Rejected: ["In Progress"],
};

async function transition(req, res, { toStatus, requireRemarksField } = {}) {
  try {
    const { id, reworkId } = req.params;
    if (!isValidId(reworkId)) {
      return res.status(400).json({ success: false, message: "Invalid rework ID" });
    }
    const { data: rework } = await supabase
      .from("job_card_reworks")
      .select("id, status, job_card_id, created_by, reason")
      .eq("id", reworkId)
      .eq("job_card_id", id)
      .eq("is_delete", false)
      .maybeSingle();
    if (!rework) {
      return res.status(404).json({ success: false, message: "Rework record not found" });
    }
    const allowed = ALLOWED_TRANSITIONS[rework.status] || [];
    if (!allowed.includes(toStatus)) {
      return res.status(400).json({ success: false, message: `Cannot move a rework record from '${rework.status}' to '${toStatus}'` });
    }
    if (requireRemarksField && !req.body[requireRemarksField]) {
      return res.status(400).json({ success: false, message: `${requireRemarksField} is required` });
    }

    const updateData = {
      status: toStatus,
      updated_by: req.user?.id || null,
      updated_at: new Date().toISOString(),
      ...(toStatus === "Approved" && { approved_by: req.user?.id || null, approved_at: new Date().toISOString() }),
    };
    const { data, error } = await supabase.from("job_card_reworks").update(updateData).eq("id", reworkId).select(SELECT).single();
    if (error) throw error;

    logAudit({ req, action: "update", module: "jobCardRework", recordId: reworkId, newValue: { status: toStatus } });

    await notifyStatusChange({
      moduleKey: "rework",
      entityType: "jobCardRework",
      entityId: reworkId,
      creatorId: rework.created_by,
      actorId: req.user?.id || null,
      toStatus,
      title: `Rework record -> ${toStatus}`,
      message: `Rework "${rework.reason}" moved from ${rework.status} to ${toStatus}.`,
      link: `/admin/job-card/view/${rework.job_card_id}`,
    });

    return { data };
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating rework status: " + error.message });
    return null;
  }
}

exports.createRework = async (req, res) => {
  try {
    const { id } = req.params;
    const { jobCardStageId, reason, defectCategory, quantity, responsibleDepartment, responsibleStaff, additionalMaterialNotes, cost } = req.body;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid job card ID" });
    }
    const { data: jobCard } = await supabase.from("job_cards").select("id").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!jobCard) {
      return res.status(404).json({ success: false, message: "Job card not found" });
    }
    if (jobCardStageId) {
      const { data: stageRow } = await supabase.from("job_card_stages").select("id").eq("id", jobCardStageId).eq("job_card_id", id).maybeSingle();
      if (!stageRow) {
        return res.status(400).json({ success: false, message: "jobCardStageId does not belong to this job card" });
      }
    }

    const { data, error } = await supabase
      .from("job_card_reworks")
      .insert({
        job_card_id: id,
        job_card_stage_id: jobCardStageId || null,
        reason,
        defect_category: defectCategory || null,
        quantity: quantity !== undefined ? parseFloat(quantity) : null,
        responsible_department: responsibleDepartment || null,
        responsible_staff_id: responsibleStaff || null,
        additional_material_notes: additionalMaterialNotes || null,
        cost: cost !== undefined ? parseFloat(cost) : null,
        created_by: req.user?.id || null,
      })
      .select(SELECT)
      .single();
    if (error) throw error;

    logAudit({ req, action: "create", module: "jobCardRework", recordId: data.id, newValue: data });

    res.status(201).json({ success: true, message: "Rework record created", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating rework record: " + error.message });
  }
};

exports.getReworksForJobCard = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid job card ID" });
    }
    const { data, error } = await supabase.from("job_card_reworks").select(SELECT).eq("job_card_id", id).eq("is_delete", false).order("created_at", { ascending: false });
    if (error) throw error;
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching rework records: " + error.message });
  }
};

exports.startRework = async (req, res) => {
  const result = await transition(req, res, { toStatus: "In Progress" });
  if (result) res.status(200).json({ success: true, data: withMongoId(result.data) });
};

exports.submitReworkForApproval = async (req, res) => {
  const result = await transition(req, res, { toStatus: "Pending Approval" });
  if (result) res.status(200).json({ success: true, data: withMongoId(result.data) });
};

exports.approveRework = async (req, res) => {
  const result = await transition(req, res, { toStatus: "Approved" });
  if (result) res.status(200).json({ success: true, data: withMongoId(result.data) });
};

exports.rejectRework = async (req, res) => {
  const result = await transition(req, res, { toStatus: "Rejected", requireRemarksField: "remarks" });
  if (result) res.status(200).json({ success: true, data: withMongoId(result.data) });
};
