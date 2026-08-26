const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, deriveInitials } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");
const { notifyStatusChange } = require("../lib/notify");

const SELECT = `
  id, opportunityNumber:opportunity_number, prospectName:prospect_name, contactPerson:contact_person,
  contactPhone:contact_phone, contactEmail:contact_email, estimatedValue:estimated_value, source, stage,
  notes, wonAt:won_at, lostAt:lost_at, lostReason:lost_reason, partyId:party_id,
  followUpDate:follow_up_date, quotationId:quotation_id,
  createdAt:created_at, updatedAt:updated_at,
  companyName:company_name_id(id, companyName:company_name),
  assignedTo:assigned_to(id, firstName:first_name, lastName:last_name),
  party:party_id(id, partyName:party_name),
  quotation:quotation_id(id, quotationNumber:quotation_number, status),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

// Module 15: expanded from the original 5-stage funnel (New/Contacted/
// Qualified/Proposal Sent/Won + Lost) to the scope doc's 7-stage funnel,
// per the user's explicit choice of "expand the funnel to match the scope
// doc" over the recommended "leave it as-is". Requirement Gathering sits
// between Qualified and Proposal Sent; Negotiation sits between Proposal
// Sent and Won. Every non-Won/non-Lost stage can still drop straight to
// Lost -- a deal dying mid-funnel is normal CRM reality, not a special
// case. Won is reachable only from Negotiation, the funnel's new final
// gate, and is handled by its own RPC (see markWon) rather than this
// generic transition path, because it does more than flip a column.
//
// No data migration was needed for existing in-flight opportunities: all
// 4 of the original non-terminal stage names (New/Contacted/Qualified/
// Proposal Sent) remain valid stage values in the new 7-stage list, so
// every existing opportunity keeps sitting at the exact stage it was
// already at -- there was nothing ambiguous to ask the user about
// per-record, despite that being the answer picked for that question.
const ALLOWED_TRANSITIONS = {
  New: ["Contacted", "Lost"],
  Contacted: ["Qualified", "Lost"],
  Qualified: ["Requirement Gathering", "Lost"],
  "Requirement Gathering": ["Proposal Sent", "Lost"],
  "Proposal Sent": ["Negotiation", "Lost"],
  Negotiation: ["Won", "Lost"],
};

const EDITABLE_STAGES = ["New", "Contacted", "Qualified", "Requirement Gathering", "Proposal Sent", "Negotiation"];

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
    const { companyName, prospectName, contactPerson, contactPhone, contactEmail, estimatedValue, source, assignedTo, notes, followUpDate } = req.body;
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

    // follow_up_date isn't part of create_opportunity_transactional's
    // signature (kept untouched) -- set with a plain follow-up update
    // instead of extending that RPC for one optional column.
    if (followUpDate) {
      await supabase.from("opportunities").update({ follow_up_date: followUpDate }).eq("id", opportunityId);
    }

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

    const { companyName, prospectName, contactPerson, contactPhone, contactEmail, estimatedValue, source, assignedTo, notes, followUpDate } = req.body;
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
      ...(followUpDate !== undefined && { follow_up_date: followUpDate || null }),
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

exports.markRequirementGathering = async (req, res) => {
  const result = await transition(req, res, { toStage: "Requirement Gathering" });
  if (result) res.status(200).json({ success: true, message: "Opportunity marked Requirement Gathering", data: withMongoId(result.data) });
};

exports.markProposalSent = async (req, res) => {
  const result = await transition(req, res, { toStage: "Proposal Sent" });
  if (result) res.status(200).json({ success: true, message: "Opportunity marked Proposal Sent", data: withMongoId(result.data) });
};

exports.markNegotiation = async (req, res) => {
  const result = await transition(req, res, { toStage: "Negotiation" });
  if (result) res.status(200).json({ success: true, message: "Opportunity marked Negotiation", data: withMongoId(result.data) });
};

exports.markLost = async (req, res) => {
  const result = await transition(req, res, { toStage: "Lost", requireRemarksField: "lostReason", extraUpdate: { lost_at: new Date().toISOString() } });
  if (result) res.status(200).json({ success: true, message: "Opportunity marked Lost", data: withMongoId(result.data) });
};

// Won is not a generic transition -- per the design decision, winning
// automatically creates the real customer party via
// convert_opportunity_won_transactional, so it gets its own RPC-backed
// path instead of the plain column-flip every other stage uses. Module
// 15 moved the gate from Proposal Sent to Negotiation, the funnel's new
// final stage before Won.
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
    if (opp.stage !== "Negotiation") {
      return res.status(400).json({ success: false, message: "Only an opportunity at Negotiation can be marked Won" });
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

// Module 15: Opportunity -> Quotation conversion. Gated on the
// opportunity already being Won rather than any earlier stage, because
// quotations.party_id is NOT NULL and party_id on an opportunity is only
// ever populated by markWon's convert_opportunity_won_transactional --
// there is no real customer party to quote against before that. Reuses
// the same create_quotation_transactional RPC createQuotation calls,
// rather than duplicating its logic, so both paths stay in sync.
// Module 16 fix (audit-reconciliation.md's carried-forward non-atomic
// conversion-pattern finding): this used to check stage/party_id/
// quotation_id in JS, call create_quotation_transactional, then
// separately update opportunities.quotation_id -- a failure between those
// two steps (or two concurrent conversions of the same opportunity) could
// leave a quotation created with quotation_id still null on the
// opportunity, convertible again into a second, orphaned quotation with
// nothing pointing back at it. convert_opportunity_to_quotation_
// transactional locks the opportunity row, re-checks stage/party_id/
// quotation_id under that lock, creates the quotation, and sets
// quotation_id all in one transaction.
exports.convertOpportunityToQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid opportunity ID" });
    }
    const { data: opp } = await supabase
      .from("opportunities")
      .select("id, company_name_id")
      .eq("id", id)
      .eq("is_delete", false)
      .maybeSingle();
    if (!opp) {
      return res.status(404).json({ success: false, message: "Opportunity not found" });
    }

    const { productItem, qty, size, specs, rateType, rate, printingrate, isGst, gstPercentage, totalAmount, validUntil, remarks } = req.body;
    if (!isValidId(productItem) || !qty) {
      return res.status(400).json({ success: false, message: "productItem and qty are required" });
    }
    const { data: productItemRow } = await supabase.from("product_items").select("id").eq("id", productItem).eq("is_delete", false).maybeSingle();
    if (!productItemRow) {
      return res.status(404).json({ success: false, message: "Product item not found" });
    }

    const { data: company } = await supabase.from("company_names").select("id, company_name").eq("id", opp.company_name_id).maybeSingle();
    const initials = deriveInitials(company?.company_name || "");

    const { data: quotationId, error } = await supabase.rpc("convert_opportunity_to_quotation_transactional", {
      p_opportunity_id: id,
      p_product_item_id: productItem,
      p_qty: parseInt(qty, 10),
      p_size: size || null,
      p_specs: specs || {},
      p_rate_type: rateType || null,
      p_rate: rate !== undefined ? parseFloat(rate) : null,
      p_printingrate: printingrate !== undefined ? parseFloat(printingrate) : null,
      p_is_gst: isGst !== false,
      p_gst_percentage: gstPercentage !== undefined ? parseFloat(gstPercentage) : null,
      p_total_amount: totalAmount !== undefined ? parseFloat(totalAmount) : null,
      p_valid_until: validUntil || null,
      p_remarks: remarks || null,
      p_created_by: req.user?.id || null,
      p_initials: initials,
    });
    if (error) {
      if (
        (error.message && error.message.includes("Only a Won opportunity")) ||
        (error.message && error.message.includes("already been converted"))
      ) {
        return res.status(400).json({ success: false, message: error.message });
      }
      throw error;
    }

    const { data: populated, error: fetchErr } = await supabase.from("opportunities").select(SELECT).eq("id", id).single();
    if (fetchErr) throw fetchErr;
    logAudit({ req, action: "update", module: "opportunity", recordId: id, newValue: { quotationId } });

    res.status(201).json({ success: true, message: "Opportunity converted to quotation", data: withMongoId(populated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error converting opportunity to quotation: " + error.message });
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
