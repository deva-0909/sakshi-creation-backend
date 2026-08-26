const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");
const { logImport } = require("../lib/importLog");

// §77: the columns a bulk-import file for this module should carry.
// NOTE: unlike the other bulk-import endpoints, bulkCreateLeads takes a
// parsed JSON array in the request body rather than an uploaded CSV file
// (see routes/lead.routes.js — POST /create/bulk has no multer/csv-parser
// wiring). This template documents the same field names for whatever
// converts a CSV to that JSON array upstream (e.g. the frontend), but
// downloadLeadTemplate/BULK_TEMPLATE_HEADERS below are descriptive only;
// they aren't read by bulkCreateLeads itself.
const BULK_TEMPLATE_HEADERS = ["companyName", "partyName", "reason", "customReason", "assignedTo", "date", "time", "status"];

const PARTY_SELECT =
  "id, partyName:party_name, ownerName:owner_name, ownerMobileNo:owner_mobile_no, ownerWhatsAppNo:owner_whatsapp_no, contactPerson:contact_person, personMobileNo:person_mobile_no, personWhatsAppNo:person_whatsapp_no, contactForPayment:contact_for_payment, contactMobileNo:contact_mobile_no, contactWhatsAppNo:contact_whatsapp_no, GSTNo:gst_no, partyTag:party_tag, address, createdAt:created_at, updatedAt:updated_at";

const LEAD_SELECT = `
  id, reason, customReason:custom_reason, status, date, time, callFeedback:call_feedback,
  rescheduleDate:reschedule_date, isRescheduledCall:is_rescheduled_call, createdAt:created_at, updatedAt:updated_at,
  companyName:company_name_id(id, companyName:company_name),
  partyName:party_name_id(${PARTY_SELECT}),
  assignedTo:assigned_to(id, firstName:first_name, lastName:last_name, email),
  originalLeadId:original_lead_id(id, date, createdAt:created_at)
`;

async function attachCreatedBy(lead) {
  if (!lead || !lead.partyName || !lead.companyName) return lead;
  const { data: am } = await supabase
    .from("account_masters")
    .select("createdBy:created_by(id, firstName:first_name, lastName:last_name)")
    .eq("party_id", lead.partyName.id)
    .eq("company_name_id", lead.companyName.id)
    .maybeSingle();
  return { ...lead, partyName: { ...lead.partyName, createdBy: am?.createdBy || null } };
}

exports.createLead = async (req, res) => {
  try {
    const { companyName, partyName, reason, customReason, assignedTo, date, time } = req.body;
    if (!companyName || !partyName || !reason || !assignedTo) {
      return res.status(400).json({ success: false, message: "All required fields must be provided" });
    }
    if (!isValidId(companyName) || !isValidId(partyName) || !isValidId(assignedTo)) {
      return res.status(400).json({ success: false, message: "Invalid ID format for companyName, partyName, or assignedTo" });
    }

    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (time && !timeRegex.test(time)) {
      return res.status(400).json({ success: false, message: "Invalid time format. Use HH:MM in 24-hour format." });
    }

    const { data: newLead, error } = await supabase
      .from("leads")
      .insert({
        company_name_id: companyName,
        party_name_id: partyName,
        reason,
        custom_reason: reason === "Other" ? customReason : null,
        assigned_to: assignedTo,
        date: date || new Date().toISOString().slice(0, 10),
        time: time || null,
      })
      .select("id")
      .single();
    if (error) throw error;

    const { data: populated } = await supabase.from("leads").select(LEAD_SELECT).eq("id", newLead.id).single();
    const withCreatedBy = await attachCreatedBy(withMongoId(populated));

    res.status(201).json({ success: true, message: "Lead created successfully", data: withCreatedBy });
  } catch (error) {
    console.error("Error creating Lead:", error);
    res.status(500).json({ success: false, message: "Server error while creating Lead", error: error.message });
  }
};

exports.getAllLeads = async (req, res) => {
  try {
    // "party_name" is not a local column on leads (it lives on the joined
    // parties table via party_name_id), so there's no cheap ilike search
    // to add here without an inner-join filter — pagination only.
    const { status, partyName, companyName, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("leads").select(LEAD_SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    if (partyName) query = query.eq("party_name_id", partyName);
    if (companyName) query = query.eq("company_name_id", companyName);
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

    // Note: this filter drops rows whose join failed to resolve (e.g. a
    // hard-deleted party/company), which is rare given FK constraints.
    // With pagination active this could in principle make a page report
    // fewer than `limit` items even when count says more remain; that's
    // an accepted edge case rather than a reason to skip pagination here.
    const validLeads = withMongoId(data).filter((l) => l.partyName && l.companyName);
    if (validLeads.length === 0) {
      return res.status(200).json({ success: true, count: 0, data: [], message: "No leads found" });
    }

    const populatedLeads = await Promise.all(validLeads.map(attachCreatedBy));

    const response = { success: true, count: populatedLeads.length, data: populatedLeads };
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
    console.error("Error fetching leads:", error);
    res.status(500).json({ success: false, message: "Server error while fetching leads", error: error.message });
  }
};

// §77: downloads a CSV template with just the header row, so an import
// file matches the field names this endpoint actually expects.
exports.downloadLeadTemplate = async (req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="lead-bulk-import-template.csv"');
  res.status(200).send(BULK_TEMPLATE_HEADERS.join(",") + "\n");
};

exports.bulkCreateLeads = async (req, res) => {
  try {
    const leadsData = req.body;
    if (!Array.isArray(leadsData) || leadsData.length === 0) {
      return res.status(400).json({ success: false, message: "Expected an array of lead data" });
    }

    // §77: this already collected per-row errors and kept going on a bad
    // row; the change here is just normalizing the error shape to
    // {row, message} (row = 1-based position in the submitted array —
    // there's no CSV header row to offset by, since the request body is
    // already a parsed JSON array) so it matches the other bulk-import
    // endpoints' history/reporting format.
    const createdLeads = [];
    const errors = [];

    for (let i = 0; i < leadsData.length; i++) {
      const leadData = leadsData[i];
      const rowNum = i + 1;
      try {
        const { companyName, partyName, reason, customReason, assignedTo, date, time, status = "pending" } = leadData;
        if (!companyName || !partyName || !reason || !assignedTo || !date) {
          errors.push({ row: rowNum, message: "Missing required fields" });
          continue;
        }
        if (!isValidId(companyName) || !isValidId(partyName) || !isValidId(assignedTo)) {
          errors.push({ row: rowNum, message: "Invalid ID format" });
          continue;
        }

        const { data: inserted, error } = await supabase
          .from("leads")
          .insert({
            company_name_id: companyName,
            party_name_id: partyName,
            reason: reason === "Other" ? customReason : reason,
            custom_reason: reason === "Other" ? customReason : null,
            assigned_to: assignedTo,
            date,
            time: time || null,
            status,
          })
          .select("id")
          .single();
        if (error) throw error;
        createdLeads.push(inserted);
      } catch (error) {
        errors.push({ row: rowNum, message: error.message || "Error processing lead" });
      }
    }

    await logImport({
      req,
      module: "lead",
      fileName: null, // bulkCreateLeads takes a JSON array body, not an uploaded file
      totalRows: leadsData.length,
      successCount: createdLeads.length,
      failedCount: errors.length,
      errors,
    });

    res.status(201).json({
      success: true,
      message: `Bulk lead creation finished: ${createdLeads.length} succeeded, ${errors.length} failed`,
      count: createdLeads.length,
      errors,
      data: withMongoId(createdLeads),
    });
  } catch (error) {
    console.error("Error in bulk lead creation:", error);
    res.status(500).json({ success: false, message: "Server error while creating leads", error: error.message });
  }
};

exports.getLeadById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid lead ID format" });
    }
    const { data: lead, error } = await supabase.from("leads").select(LEAD_SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    const populated = await attachCreatedBy(withMongoId(lead));
    res.status(200).json({ success: true, data: populated });
  } catch (error) {
    console.error("Error fetching lead by ID:", error);
    res.status(500).json({ success: false, message: "Server error while fetching lead", error: error.message });
  }
};

exports.updateLeadById = async (req, res) => {
  try {
    const { id } = req.params;
    const { companyName, partyName, reason, customReason, assignedTo, status, date, time, callFeedback, rescheduleDate } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid lead ID format" });
    }
    const { data: lead } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    if (status && !["pending", "completed", "cancelled", "rescheduled"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status provided" });
    }
    if (callFeedback === undefined || callFeedback === "") {
      return res.status(400).json({ success: false, message: "Call feedback is required for updates" });
    }
    if (time && !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
      return res.status(400).json({ success: false, message: "Invalid time format. Use HH:MM (24-hour format)" });
    }

    let newLeadRecord = null;
    if (status === "rescheduled") {
      if (!rescheduleDate || isNaN(new Date(rescheduleDate).getTime())) {
        return res.status(400).json({ success: false, message: "Valid reschedule date is required for rescheduled status" });
      }
      const rescheduleDateObj = new Date(rescheduleDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (rescheduleDateObj < today) {
        return res.status(400).json({ success: false, message: "Reschedule date must be a future date" });
      }

      const { data: inserted, error } = await supabase
        .from("leads")
        .insert({
          company_name_id: lead.company_name_id,
          party_name_id: lead.party_name_id,
          reason: lead.reason,
          custom_reason: lead.custom_reason,
          assigned_to: lead.assigned_to,
          date: rescheduleDateObj.toISOString().slice(0, 10),
          time: lead.time,
          status: "pending",
          call_feedback: callFeedback,
          is_rescheduled_call: true,
          original_lead_id: lead.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      const { data: populatedNew } = await supabase.from("leads").select(LEAD_SELECT).eq("id", inserted.id).single();
      newLeadRecord = await attachCreatedBy(withMongoId(populatedNew));
    }

    const updateData = {
      ...(companyName && { company_name_id: companyName }),
      ...(partyName && { party_name_id: partyName }),
      ...(reason && { reason }),
      ...(reason === "Other" && customReason ? { custom_reason: customReason } : reason && reason !== "Other" ? { custom_reason: null } : {}),
      ...(assignedTo && { assigned_to: assignedTo }),
      ...(status && { status }),
      ...(date && { date }),
      ...(time && { time }),
      ...(callFeedback && { call_feedback: callFeedback }),
      reschedule_date: status === "rescheduled" ? rescheduleDate : null,
      updated_at: new Date().toISOString(),
    };

    const { error: updateErr } = await supabase.from("leads").update(updateData).eq("id", id);
    if (updateErr) throw updateErr;

    const { data: updatedLead } = await supabase.from("leads").select(LEAD_SELECT).eq("id", id).single();
    const populatedLead = await attachCreatedBy(withMongoId(updatedLead));

    const responseData = { originalLead: populatedLead };
    if (status === "rescheduled" && newLeadRecord) {
      responseData.newLead = { message: "New lead created with rescheduled date", rescheduledDate: rescheduleDate, data: newLeadRecord };
    }

    res.status(200).json({
      success: true,
      message: status === "rescheduled" ? "Lead rescheduled successfully and new lead created" : "Lead updated successfully",
      data: responseData,
    });
  } catch (error) {
    console.error("Error updating lead:", error);
    res.status(500).json({ success: false, message: "Server error while updating lead", error: error.message });
  }
};

exports.updateLeadStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!["pending", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status value" });
    }
    const { data, error } = await supabase
      .from("leads")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .select(LEAD_SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    res.status(200).json({ success: true, message: "Lead status updated successfully", data: withMongoId(data) });
  } catch (error) {
    console.error("Error updating lead status:", error);
    res.status(500).json({ success: false, message: "Failed to update lead status", error: error.message });
  }
};

exports.deleteLead = async (req, res) => {
  try {
    const { data, error } = await supabase.from("leads").update({ is_delete: true }).eq("id", req.params.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    res.status(200).json({ success: true, message: "Lead deleted successfully" });
  } catch (error) {
    console.error("Error deleting lead:", error);
    res.status(500).json({ success: false, message: "Failed to delete lead", error: error.message });
  }
};

exports.getPartyNamesByCompany = async (req, res) => {
  try {
    const { companyName } = req.query;
    if (!companyName || !isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid companyName ID" });
    }
    const { data, error } = await supabase
      .from("account_masters")
      .select("party:party_id(party_name)")
      .eq("company_name_id", companyName);
    if (error) throw error;
    res.status(200).json({ success: true, data: (data || []).map((p) => p.party?.party_name).filter(Boolean) });
  } catch (error) {
    console.error("Error fetching parties:", error);
    res.status(500).json({ success: false, message: "Failed to fetch parties", error: error.message });
  }
};

exports.getLeadsByStaffId = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid staff ID format" });
    }
    const { data: staff } = await supabase.from("staff").select("id").eq("id", id).maybeSingle();
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff member not found" });
    }
    const { data, error } = await supabase
      .from("leads")
      .select(LEAD_SELECT)
      .eq("assigned_to", id)
      .eq("is_delete", false)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const validLeads = withMongoId(data).filter((l) => l.companyName && l.partyName);
    if (validLeads.length === 0) {
      return res.status(200).json({ success: true, message: "No valid leads found for this staff member", count: 0, data: [] });
    }
    const enriched = await Promise.all(validLeads.map(attachCreatedBy));

    res.status(200).json({ success: true, message: "Leads retrieved successfully", count: enriched.length, data: enriched });
  } catch (error) {
    console.error("Error fetching leads by staff ID:", error);
    res.status(500).json({ success: false, message: "Failed to fetch leads", error: error.message });
  }
};
