const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, deriveInitials } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

// Two-company Phase 3 Part A (claude/two-company-gap-analysis.md): the
// "All Complains" nav item from the Figma reference's Quality Packaging
// dashboard. Standalone table (subject/description/priority/status/
// resolution doesn't fit any existing entity) with the same optional
// company_name_id scoping pattern used since Phase 1. Auto-numbered via
// next_document_number('complaint', ...), same mechanism as quotations/
// job cards/orders.
const SELECT = `
  id, complaintNumber:complaint_number, subject, description, priority, status, resolutionNotes:resolution_notes,
  resolvedAt:resolved_at,
  createdAt:created_at, updatedAt:updated_at,
  party:party_id(id, partyName:party_name),
  order:order_id(id, orderNumber:order_number),
  assignedTo:assigned_to(id, firstName:first_name, lastName:last_name),
  companyName:company_name_id(id, companyName:company_name)
`;

exports.createComplaint = async (req, res) => {
  try {
    const { subject, description, priority, party, order, assignedTo, companyName } = req.body;
    if (!subject) {
      return res.status(400).json({ success: false, message: "Subject is required" });
    }
    if (party && !isValidId(party)) {
      return res.status(400).json({ success: false, message: "Invalid party ID" });
    }
    if (order && !isValidId(order)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }
    if (assignedTo && !isValidId(assignedTo)) {
      return res.status(400).json({ success: false, message: "Invalid assignedTo ID" });
    }
    let companyRow = null;
    if (companyName && isValidId(companyName)) {
      const { data: company } = await supabase.from("company_names").select("id, company_name").eq("id", companyName).maybeSingle();
      if (!company) {
        return res.status(400).json({ success: false, message: `Invalid companyName ID: ${companyName}` });
      }
      companyRow = company;
    }

    const initials = deriveInitials(companyRow?.company_name);
    const { data: complaintNumber, error: numError } = await supabase.rpc("next_document_number", {
      p_doc_type: "complaint",
      p_initials: initials,
    });
    if (numError) throw numError;

    const { data, error } = await supabase
      .from("complaints")
      .insert({
        complaint_number: complaintNumber,
        company_name_id: companyRow?.id || null,
        party_id: party || null,
        order_id: order || null,
        subject,
        description: description || null,
        priority: priority || "Normal",
        assigned_to: assignedTo || null,
        created_by: req.user?.id || null,
      })
      .select(SELECT)
      .single();
    if (error) throw error;

    logAudit({ req, action: "create", module: "complaint", recordId: data.id, newValue: data });

    res.status(201).json({ success: true, message: "Complaint created successfully", data: withMongoId(data) });
  } catch (error) {
    console.error("Error creating complaint:", error);
    res.status(500).json({ success: false, message: "Error creating complaint: " + error.message });
  }
};

exports.getAllComplaints = async (req, res) => {
  try {
    const { page, limit, search, companyName, status, priority } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("complaints").select(SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (companyName && isValidId(companyName)) {
      query = query.or(`company_name_id.is.null,company_name_id.eq.${companyName}`);
    }
    if (status) query = query.eq("status", status);
    if (priority) query = query.eq("priority", priority);
    if (search) query = query.or(`complaint_number.ilike.%${search}%,subject.ilike.%${search}%`);

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
    res.status(500).json({ success: false, message: "Error fetching complaints: " + error.message });
  }
};

exports.getComplaintById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid complaint ID" });
    }
    const { data, error } = await supabase.from("complaints").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Complaint not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching complaint: " + error.message });
  }
};

exports.updateComplaint = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid complaint ID" });
    }
    const { subject, description, priority, status, party, order, assignedTo, resolutionNotes, companyName } = req.body;

    if (party !== undefined && party !== null && party !== "" && !isValidId(party)) {
      return res.status(400).json({ success: false, message: "Invalid party ID" });
    }
    if (order !== undefined && order !== null && order !== "" && !isValidId(order)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }
    if (assignedTo !== undefined && assignedTo !== null && assignedTo !== "" && !isValidId(assignedTo)) {
      return res.status(400).json({ success: false, message: "Invalid assignedTo ID" });
    }
    // Tri-state, same convention as dyePunch/productItem: undefined = leave
    // unchanged, ""/null = un-scope, a valid id = re-scope (validated).
    let companyIdToSet;
    if (companyName !== undefined) {
      if (!companyName) {
        companyIdToSet = null;
      } else {
        if (!isValidId(companyName)) {
          return res.status(400).json({ success: false, message: "Invalid companyName ID" });
        }
        const { data: company } = await supabase.from("company_names").select("id").eq("id", companyName).maybeSingle();
        if (!company) {
          return res.status(400).json({ success: false, message: `Invalid companyName ID: ${companyName}` });
        }
        companyIdToSet = companyName;
      }
    }

    const updateData = {
      ...(subject !== undefined && { subject }),
      ...(description !== undefined && { description: description || null }),
      ...(priority !== undefined && { priority }),
      ...(status !== undefined && { status }),
      // Full Figma slide scan Phase 1 (claude/full-figma-slide-scan.md,
      // Theme 8): stamp resolved_at the moment a complaint's status is set
      // to Resolved, and clear it if it's ever reopened (moved to any other
      // status) -- so a later re-resolve gets a fresh timestamp rather than
      // showing a stale one from a prior resolution.
      ...(status !== undefined && { resolved_at: status === "Resolved" ? new Date().toISOString() : null }),
      ...(party !== undefined && { party_id: party || null }),
      ...(order !== undefined && { order_id: order || null }),
      ...(assignedTo !== undefined && { assigned_to: assignedTo || null }),
      ...(resolutionNotes !== undefined && { resolution_notes: resolutionNotes || null }),
      ...(companyName !== undefined && { company_name_id: companyIdToSet }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };

    const { data, error } = await supabase.from("complaints").update(updateData).eq("id", id).eq("is_delete", false).select(SELECT).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Complaint not found" });
    }

    logAudit({ req, action: "update", module: "complaint", recordId: id, newValue: data });

    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating complaint: " + error.message });
  }
};

exports.deleteComplaint = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid complaint ID" });
    }
    const { data, error } = await supabase.from("complaints").update({ is_delete: true }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Complaint not found" });
    }
    logAudit({ req, action: "delete", module: "complaint", recordId: id });
    res.status(200).json({ success: true, message: "Complaint deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting complaint: " + error.message });
  }
};
