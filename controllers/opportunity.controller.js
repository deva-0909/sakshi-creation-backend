const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, deriveInitials } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");
const { notifyStatusChange } = require("../lib/notify");

const SELECT = `
  id, opportunityNumber:opportunity_number, prospectName:prospect_name, contactPerson:contact_person,
  contactPhone:contact_phone, contactEmail:contact_email, estimatedValue:estimated_value, source, stage,
  notes, wonAt:won_at, lostAt:lost_at, lostReason:lost_reason, partyId:party_id,
  createdAt:created_at, updatedAt:updated_at,
  companyName:company_name_id(id, companyName:company_name),
  assignedTo:assigned_to(id, firstName:first_name, lastName:last_name),
  party:party_id(id, partyName:party_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

// Every non-Won/non-Lost stage can drop straight to Lost -- a deal dying
// mid-funnel is normal CRM reality, not a special case. Won is reachable
// only from Proposal Sent, the funnel's final gate, and is handled by its
// own RPC (see convertToWon) rather than this generic transition path,
// because it does more than flip a column.
const ALLOWED_TRANSITIONS = {
  New: ["Contacted", "Lost"],
  Contacted: ["Qualified", "Lost"],
  Qualified: ["Proposal Sent", "Lost"],
  "Proposal Sent": ["Won", "Lost"],
};

const EDITABLE_STAGES = ["New", "Contacted", "Qualified", "Proposal Sent"];

async function recordHistory({ opportunityId, fromStage, toStage, changedBy, remarks }) {
  const { error } = await supabase.from("opportunity_stage_history").insert({
    opportunity_id: opportunityId,
    from_stage: fromStage,
    to_stage: toStage,
    changed_by: changedBy || null,
    remarks: remarks || null,
  });
  if (error) console.error("Opportunity stage history insert failed:", error.message);
}

async function transition(req, res, { toStage, requireRemarksField, extraUpdate = {} } = {}) {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid opportunity ID" });
    }
    const { data: opp } = await supabase.from("opportunities").select("id, stage, created_by").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!opp) {
      return res.status(404).json({ success: false, message: "Opportunity not found" });
    }
    const allowed = ALLOWED_TRANSITIONS[opp.stage] || [];
    if (!allowed.includes(toStage)) {
      return res.status(400).json({ success: false, message: `Cannot move an opportunity from '${opp.stage}' to '${toStage}'` });
    }
    if (requireRemarksField && !req.body[requireRemarksField]) {
      return res.status(400).json({ success: false, message: `${requireRemarksField} is required` });
    }

    const updateData = {
      stage: toStage,
      updated_by: req.user?.id || null,
      updated_at: new Date().toISOString(),
      ...extraUpdate,
    };
    const { data, error } = await supabase.from("opportunities").update(updateData).eq("id", id).select(SELECT).single();
    if (error) throw error;

    await recordHistory({
      opportunityId: id,
      fromStage: opp.stage,
      toStage,
      changedBy: req.user?.id || null,
      remarks: requireRemarksField ? req.body[requireRemarksField] : req.body.remarks,
    });

    logAudit({ req, action: "update", module: "opportunity", recordId: id, newValue: { stage: toStage } });

    // Reuses Module 5's notification plumbing even though Opportunity has
    // no approve-gated step -- toStatus never equals "Pending Approval"
    // here, so only the creator (when they're not the actor) is notified,
    // which is exactly what a stage change on someone else's opportunity
    // should do.
    await notifyStatusChange({
      moduleKey: "opportunity",
      entityType: "opportunity",
      entityId: id,
      creatorId: opp.created_by,
      actorId: req.user?.id || null,
      toStatus: toStage,
      title: `Opportunity ${data.opportunityNumber} -> ${toStage}`,
      message: `Opportunity ${data.opportunityNumber} moved from ${opp.stage} to ${toStage}.`,
      link: `/admin/crm/opportunities/view/${id}`,
    });

    return { data };
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating opportunity stage: " + error.message });
    return null;
  }
}

exports.createOpportunity = async (req, res) => {
  try {
    const { companyName, prospectName, contactPerson, contactPhone, contactEmail, estimatedValue, source, assignedTo, notes } = req.body;
    if (!isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid company ID" });
    }
    const { data: company } = await supabase.from("company_names").select("id, company_name").eq("id", companyName).maybeSingle();
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }
    if (assignedTo && !isValidId(assignedTo)) {
      return res.status(400).json({ success: false, message: "Invalid assignedTo staff ID" });
    }

    const initials = deriveInitials(company.company_name);

    const { data: opportunityId, error } = await supabase.rpc("create_opportunity_transactional", {
      p_company_name_id: companyName,
      p_prospect_name: prospectName,
      p_contact_person: contactPerson || null,
      p_contact_phone: contactPhone,
      p_contact_email: contactEmail || null,
      p_estimated_value: estimatedValue !== undefined ? parseFloat(estimatedValue) : null,
      p_source: source || null,
      p_assigned_to: assignedTo || null,
      p_notes: notes || null,
      p_created_by: req.user?.id || null,
      p_initials: initials,
    });
    if (error) throw error;

    const { data: populated } = await supabase.from("opportunities").select(SELECT).eq("id", opportunityId).single();
    logAudit({ req, action: "create", module: "opportunity", recordId: opportunityId, newValue: populated });

    res.status(201).json({ success: true, message: "Opportunity created successfully", data: withMongoId(populated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating opportunity: " + error.message });
  }
};

exports.getAllOpportunities = async (req, res) => {
  try {
    const { stage, partyId, assignedTo, search, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("opportunities").select(SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (stage) query = query.eq("stage", stage);
    // Powers the party detail page's "opportunity history" panel (Module 7
    // design decision) without a separate endpoint -- a party's won/lost
    // deals are just opportunities filtered by their own party_id.
    if (partyId) query = query.eq("party_id", partyId);
    if (assignedTo) query = query.eq("assigned_to", assignedTo);
    if (search && String(search).trim()) query = query.ilike("prospect_name", `%${String(search).trim()}%`);

    let pageNum, limitNum, from;
    if (paginate) {
      pageNum = parseInt(page, 10) || 1;
      limitNum = parseInt(limit, 10) || 10;
      from = (pageNum - 1) * limitNum;
      query = query.range(from, from + limitNum - 1);
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
    res.status(500).json({ success: false, message: "Error fetching opportunities: " + error.message });
  }
};

exports.getOpportunityById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid opportunity ID" });
    }
    const { data, error } = await supabase.from("opportunities").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Opportunity not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching opportunity: " + error.message });
  }
};

exports.updateOpportunity = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid opportunity ID" });
    }
    const { data: existing } = await supabase.from("opportunities").select("id, stage").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!existing) {
      return res.status(404).json({ success: false, message: "Opportunity not found" });
    }
    if (!EDITABLE_STAGES.includes(existing.stage)) {
      return res.status(400).json({ success: false, message: "A Won or Lost opportunity can no longer be edited" });
    }

    const { companyName, prospectName, contactPerson, contactPhone, contactEmail, estimatedValue, source, assignedTo, notes } = req.body;
    if (companyName && !isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid company ID" });
    }
    if (assignedTo !== undefined && assignedTo !== null && !isValidId(assignedTo)) {
      return res.status(400).json({ success: false, message: "Invalid assignedTo staff ID" });
    }

    const updateData = {
      ...(companyName && { company_name_id: companyName }),
      ...(prospectName !== undefined && { prospect_name: prospectName }),
      ...(contactPerson !== undefined && { contact_person: contactPerson }),
      ...(contactPhone !== undefined && { contact_phone: contactPhone }),
      ...(contactEmail !== undefined && { contact_email: contactEmail }),
      ...(estimatedValue !== undefined && { estimated_value: parseFloat(estimatedValue) }),
      ...(source !== undefined && { source }),
      ...(assignedTo !== undefined && { assigned_to: assignedTo || null }),
      ...(notes !== undefined && { notes }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };

    const { data, error } = await supabase.from("opportunities").update(updateData).eq("id", id).select(SELECT).single();
    if (error) throw error;

    logAudit({ req, action: "update", module: "opportunity", recordId: id, newValue: data });
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating opportunity: " + error.message });
  }
};

exports.deleteOpportunity = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid opportunity ID" });
    }
    const { data, error } = await supabase.from("opportunities").update({ is_delete: true }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Opportunity not found" });
    }
    logAudit({ req, action: "delete", module: "opportunity", recordId: id });
    res.status(200).json({ success: true, message: "Opportunity deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting opportunity: " + error.message });
  }
};

exports.markContacted = async (req, res) => {
  const result = await transition(req, res, { toStage: "Contacted" });
  if (result) res.status(200).json({ success: true, message: "Opportunity marked Contacted", data: withMongoId(result.data) });
};

exports.markQualified = async (req, res) => {
  const result = await transition(req, res, { toStage: "Qualified" });
  if (result) res.status(200).json({ success: true, message: "Opportunity marked Qualified", data: withMongoId(result.data) });
};

exports.markProposalSent = async (req, res) => {
  const result = await transition(req, res, { toStage: "Proposal Sent" });
  if (result) res.status(200).json({ success: true, message: "Opportunity marked Proposal Sent", data: withMongoId(result.data) });
};

exports.markLost = async (req, res) => {
  const result = await transition(req, res, { toStage: "Lost", requireRemarksField: "lostReason", extraUpdate: { lost_at: new Date().toISOString() } });
  if (result) res.status(200).json({ success: true, message: "Opportunity marked Lost", data: withMongoId(result.data) });
};

// Won is not a generic transition -- per the design decision, winning
// automatically creates the real customer party via
// convert_opportunity_won_transactional, so it gets its own RPC-backed
// path instead of the plain column-flip every other stage uses.
exports.markWon = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid opportunity ID" });
    }
    const { data: opp } = await supabase.from("opportunities").select("id, stage, opportunity_number").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!opp) {
      return res.status(404).json({ success: false, message: "Opportunity not found" });
    }
    if (opp.stage !== "Proposal Sent") {
      return res.status(400).json({ success: false, message: "Only an opportunity at Proposal Sent can be marked Won" });
    }

    const { data: partyId, error } = await supabase.rpc("convert_opportunity_won_transactional", {
      p_opportunity_id: id,
      p_actor_id: req.user?.id || null,
    });
    if (error) throw error;

    const { data: populated } = await supabase.from("opportunities").select(SELECT).eq("id", id).single();
    logAudit({ req, action: "update", module: "opportunity", recordId: id, newValue: { stage: "Won", partyId } });

    res.status(200).json({ success: true, message: "Opportunity won -- party created", data: withMongoId(populated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error marking opportunity won: " + error.message });
  }
};

exports.getOpportunityHistory = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid opportunity ID" });
    }
    const { data, error } = await supabase
      .from("opportunity_stage_history")
      .select("id, fromStage:from_stage, toStage:to_stage, remarks, createdAt:created_at, changedBy:changed_by(id, firstName:first_name, lastName:last_name)")
      .eq("opportunity_id", id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching opportunity history: " + error.message });
  }
};

exports.getOpportunityActivities = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid opportunity ID" });
    }
    const { data, error } = await supabase
      .from("opportunity_activities")
      .select("id, type, notes, activityDate:activity_date, createdAt:created_at, createdBy:created_by(id, firstName:first_name, lastName:last_name)")
      .eq("opportunity_id", id)
      .order("activity_date", { ascending: false });
    if (error) throw error;
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching opportunity activities: " + error.message });
  }
};

exports.addOpportunityActivity = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid opportunity ID" });
    }
    const { data: opp } = await supabase.from("opportunities").select("id").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!opp) {
      return res.status(404).json({ success: false, message: "Opportunity not found" });
    }

    const { type, notes, activityDate } = req.body;
    const { data, error } = await supabase
      .from("opportunity_activities")
      .insert({
        opportunity_id: id,
        type: type || "note",
        notes,
        activity_date: activityDate || new Date().toISOString(),
        created_by: req.user?.id || null,
      })
      .select("id, type, notes, activityDate:activity_date, createdAt:created_at")
      .single();
    if (error) throw error;

    logAudit({ req, action: "create", module: "opportunity_activity", recordId: data.id, newValue: data });
    res.status(201).json({ success: true, message: "Activity logged", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error logging opportunity activity: " + error.message });
  }
};
