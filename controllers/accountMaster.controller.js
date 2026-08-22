const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");
const { logImport } = require("../lib/importLog");
const XLSX = require("xlsx");

// §77: the CSV/XLSX template a bulk-import file must match. companyName
// and createdBy are supplied once for the whole file (via the request
// body alongside the upload), so the per-row columns are everything else
// that goes on the party + account_master pair.
const BULK_TEMPLATE_HEADERS = [
  "partyName", "ownerName", "ownerMobileNo", "ownerWhatsAppNo", "ownerEmail",
  "contactPerson", "personMobileNo", "personWhatsAppNo", "contactPersonEmail",
  "contactForPayment", "contactMobileNo", "contactWhatsAppNo", "contactForPaymentEmail",
  "GSTNo", "state", "unitNo", "marketName", "streetAddress", "landMark", "area", "pincode",
  "reasonToVisit", "reference", "isRequestMode",
];

const PARTY_SELECT =
  "id, companyName:company_name_id, partyName:party_name, ownerName:owner_name, ownerMobileNo:owner_mobile_no, ownerWhatsAppNo:owner_whatsapp_no, ownerEmail:owner_email, contactPerson:contact_person, personMobileNo:person_mobile_no, personWhatsAppNo:person_whatsapp_no, contactPersonEmail:contact_person_email, contactForPayment:contact_for_payment, contactMobileNo:contact_mobile_no, contactWhatsAppNo:contact_whatsapp_no, contactForPaymentEmail:contact_for_payment_email, GSTNo:gst_no, state, address, partyTag:party_tag, statusApproval:status_approval, createdAt:created_at, updatedAt:updated_at";

const AM_SELECT = `
  id, reasonToVisit:reason_to_visit, reference, createdAt:created_at, updatedAt:updated_at,
  companyName:company_name_id(id, companyName:company_name, avatar),
  party:party_id(${PARTY_SELECT}),
  createdBy:created_by(id, firstName:first_name, lastName:last_name, email)
`;

exports.createAccountMaster = async (req, res) => {
  try {
    const partyRequiredFields = ["partyName", "ownerWhatsAppNo", "address"];
    for (const field of partyRequiredFields) {
      if (!req.body[field]) {
        return res.status(400).json({ success: false, message: `Missing required party field: ${field}` });
      }
    }
    const requiredAddressFields = ["unitNo", "marketName", "streetAddress", "area", "pincode"];
    for (const field of requiredAddressFields) {
      if (!req.body.address[field]) {
        return res.status(400).json({ success: false, message: `Missing required address field: ${field}` });
      }
    }
    if (!/^[0-9]{6}$/.test(req.body.address.pincode)) {
      return res.status(400).json({ success: false, message: "Invalid pincode format. Must be 6 digits." });
    }
    if (!req.body.companyName || !req.body.reasonToVisit || !req.body.createdBy) {
      return res.status(400).json({ success: false, message: "Missing required fields: companyName, reasonToVisit, or createdBy" });
    }
    const emailRegex = /^\S+@\S+\.\S+$/;
    for (const f of ["ownerEmail", "contactPersonEmail", "contactForPaymentEmail"]) {
      if (req.body[f] && !emailRegex.test(req.body[f])) {
        return res.status(400).json({ success: false, message: `Invalid ${f} format` });
      }
    }

    const { data: staff } = await supabase.from("staff").select("id").eq("id", req.body.createdBy).maybeSingle();
    if (!staff) {
      return res.status(400).json({ success: false, message: "Invalid createdBy ID. Staff member does not exist." });
    }
    const { data: company } = await supabase.from("company_names").select("id").eq("id", req.body.companyName).maybeSingle();
    if (!company) {
      return res.status(400).json({ success: false, message: "Invalid companyName ID. Company does not exist." });
    }

    const { data: existingParty } = await supabase
      .from("parties")
      .select("id")
      .eq("company_name_id", req.body.companyName)
      .eq("party_name", req.body.partyName)
      .eq("owner_whatsapp_no", req.body.ownerWhatsAppNo)
      .eq("is_delete", false)
      .maybeSingle();
    if (existingParty) {
      return res.status(400).json({ success: false, message: "A party with this company, name and mobile number already exists" });
    }

    const { data: newParty, error: partyErr } = await supabase
      .from("parties")
      .insert({
        company_name_id: req.body.companyName,
        party_name: req.body.partyName,
        owner_name: req.body.ownerName,
        owner_mobile_no: req.body.ownerMobileNo,
        owner_whatsapp_no: req.body.ownerWhatsAppNo,
        owner_email: req.body.ownerEmail || null,
        contact_person: req.body.contactPerson,
        person_mobile_no: req.body.personMobileNo,
        contact_person_email: req.body.contactPersonEmail || null,
        person_whatsapp_no: req.body.personWhatsAppNo,
        contact_for_payment: req.body.contactForPayment,
        contact_mobile_no: req.body.contactMobileNo,
        contact_whatsapp_no: req.body.contactWhatsAppNo,
        contact_for_payment_email: req.body.contactForPaymentEmail || null,
        gst_no: req.body.GSTNo || null,
        state: req.body.state || null,
        address: req.body.address,
        status_approval: req.body.isRequestMode ? "Pending" : "Approved",
      })
      .select("id")
      .single();
    if (partyErr) throw partyErr;

    const { data: newAM, error: amErr } = await supabase
      .from("account_masters")
      .insert({
        company_name_id: req.body.companyName,
        party_id: newParty.id,
        reason_to_visit: req.body.reasonToVisit,
        reference: req.body.reference || null,
        created_by: req.body.createdBy,
      })
      .select("id")
      .single();
    if (amErr) throw amErr;

    const { data: populated } = await supabase.from("account_masters").select(AM_SELECT).eq("id", newAM.id).single();

    res.status(201).json({ success: true, message: "Account master created successfully", data: withMongoId(populated) });
  } catch (error) {
    console.error("Error creating account master:", error);
    res.status(500).json({ success: false, message: "Failed to create account master", error: error.message });
  }
};

async function enrichWithLatestTask(accounts) {
  const partyIds = accounts.map((a) => a.party?.id).filter(Boolean);
  if (partyIds.length === 0) return accounts.map((a) => ({ ...a, assignment: fallbackAssignment(a) }));

  const { data: tasks } = await supabase
    .from("assign_tasks")
    .select("party_name_id, company_name_id, remarks, status, assign_to:assign_to(id, firstName:first_name, lastName:last_name, email), created_at")
    .in("party_name_id", partyIds)
    .order("created_at", { ascending: false });

  const taskMap = {};
  (tasks || []).forEach((t) => {
    const key = `${t.party_name_id}_${t.company_name_id}`;
    if (!taskMap[key]) taskMap[key] = t;
  });

  return accounts.map((account) => {
    const key = `${account.party?.id}_${account.companyName?.id}`;
    const latest = taskMap[key];
    const assignment = latest
      ? { assignedTo: latest.assign_to || account.createdBy, remarks: latest.remarks || "NA", status: latest.status || "Not Started" }
      : fallbackAssignment(account);
    return { ...account, assignment };
  });
}

function fallbackAssignment(account) {
  return { assignedTo: account.createdBy, remarks: "NA", status: "Not Started" };
}

// NOTE (Patch 10 / audit §53-§54): deliberately NOT adding DB-level
// pagination here. `statusApproval` and the party-null check below are
// applied in JS *after* the query returns, and enrichWithLatestTask further
// reshapes rows. If we added `.range()` on the initial query, `count` from
// Supabase would reflect the pre-filter total while the returned page would
// reflect the post-filter subset — currentPage/totalPages/hasNext would be
// wrong, and a page could come back with fewer than `limit` valid rows even
// though more exist. Doing this safely would require moving statusApproval
// filtering into the query (feasible, since it's a party-table column) and
// re-deriving totalCount only after enrichment, which is more than a
// mechanical port of the getAllOrders pattern. Left unpaginated on purpose.
exports.getAllAccountMasters = async (req, res) => {
  try {
    const { statusApproval } = req.query;

    let query = supabase.from("account_masters").select(AM_SELECT).eq("is_delete", false).order("created_at", { ascending: false });
    const { data: accountMasters, error } = await query;
    if (error) throw error;

    let filtered = accountMasters.filter((a) => a.party);
    if (statusApproval && ["Pending", "Approved"].includes(statusApproval)) {
      filtered = filtered.filter((a) => a.party.statusApproval === statusApproval);
    }

    const enriched = await enrichWithLatestTask(withMongoId(filtered));

    res.status(200).json({ success: true, count: enriched.length, data: enriched });
  } catch (error) {
    console.error("Error getting account masters:", error);
    res.status(500).json({ success: false, message: "Failed to fetch account masters", error: error.message });
  }
};

// §77: downloads a CSV template with just the header row, so an import
// file matches the columns this endpoint actually expects.
exports.downloadAccountMasterTemplate = async (req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="accountMaster-bulk-import-template.csv"');
  res.status(200).send(BULK_TEMPLATE_HEADERS.join(",") + "\n");
};

exports.bulkCreateAccountMasters = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }
    const globalCompanyName = req.body.companyName;
    const globalCreatedBy = req.body.createdBy;
    if (!globalCompanyName || !globalCreatedBy) {
      return res.status(400).json({ success: false, message: "companyName and createdBy are required in the request body" });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    const { data: company } = await supabase.from("company_names").select("id").eq("id", globalCompanyName).maybeSingle();
    if (!company) {
      return res.status(400).json({ success: false, message: `Invalid companyName ID: ${globalCompanyName}` });
    }
    const { data: staff } = await supabase.from("staff").select("id").eq("id", globalCreatedBy).maybeSingle();
    if (!staff) {
      return res.status(400).json({ success: false, message: `Invalid createdBy ID: ${globalCreatedBy}` });
    }

    // §77: previously a failed party or account_master insert on any row
    // threw and aborted the whole file (leaving earlier rows' parties/
    // account_masters committed but nothing reported back). Now every row
    // is processed independently and both outcomes are reported.
    //
    // Judgment call for the party -> account_master dependent pair: each
    // row does two inserts (parties, then account_masters keyed off the
    // new party's id). If the party insert fails, there's nothing to
    // clean up -- just record the row's error and move on. If the party
    // insert succeeds but the dependent account_master insert then fails,
    // leaving that party row behind would be an orphan with no
    // account_master ever pointing at it (the whole point of this
    // endpoint is to create the pair together) and no way for the caller
    // to discover or reconcile it from the response. So on that specific
    // failure this compensates by deleting the just-inserted party before
    // recording the row's error, keeping the two tables consistent with
    // what the response actually reports as "succeeded" -- at the cost of
    // one extra delete call for that row only.
    const createdIds = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // header is row 1, first data row is row 2

      const { data: newParty, error: partyErr } = await supabase
        .from("parties")
        .insert({
          company_name_id: globalCompanyName,
          party_name: row.partyName || null,
          owner_name: row.ownerName || null,
          owner_mobile_no: row.ownerMobileNo || null,
          owner_whatsapp_no: row.ownerWhatsAppNo || null,
          owner_email: row.ownerEmail || null,
          contact_person: row.contactPerson || null,
          person_mobile_no: row.personMobileNo || null,
          person_whatsapp_no: row.personWhatsAppNo || null,
          contact_person_email: row.contactPersonEmail || null,
          contact_for_payment: row.contactForPayment || null,
          contact_mobile_no: row.contactMobileNo || null,
          contact_whatsapp_no: row.contactWhatsAppNo || null,
          contact_for_payment_email: row.contactForPaymentEmail || null,
          gst_no: row.GSTNo || null,
          state: row.state || null,
          address: {
            unitNo: row.unitNo || null,
            marketName: row.marketName || null,
            streetAddress: row.streetAddress || null,
            landMark: row.landMark || null,
            area: row.area || null,
            pincode: row.pincode || null,
          },
          status_approval: row.isRequestMode === "TRUE" ? "Pending" : "Approved",
        })
        .select("id")
        .single();

      if (partyErr) {
        errors.push({ row: rowNum, message: `Failed to create party: ${partyErr.message}` });
        continue;
      }

      const { data: newAM, error: amErr } = await supabase
        .from("account_masters")
        .insert({
          company_name_id: globalCompanyName,
          party_id: newParty.id,
          reason_to_visit: row.reasonToVisit || null,
          reference: row.reference || null,
          created_by: globalCreatedBy,
        })
        .select("id")
        .single();

      if (amErr) {
        // Compensate: don't leave an orphaned party with no account_master.
        await supabase.from("parties").delete().eq("id", newParty.id);
        errors.push({ row: rowNum, message: `Party created but failed to create account master (rolled back): ${amErr.message}` });
        continue;
      }
      createdIds.push(newAM.id);
    }

    const { data: populated } = createdIds.length
      ? await supabase.from("account_masters").select(AM_SELECT).in("id", createdIds)
      : { data: [] };

    await logImport({
      req,
      module: "accountMaster",
      fileName: req.file.originalname,
      totalRows: rows.length,
      successCount: createdIds.length,
      failedCount: errors.length,
      errors,
    });

    res.status(200).json({
      success: true,
      message: `Bulk account master upload finished: ${createdIds.length} succeeded, ${errors.length} failed`,
      count: createdIds.length,
      errors,
      data: withMongoId(populated),
    });
  } catch (error) {
    console.error("Error in bulk create account masters:", error);
    res.status(500).json({ success: false, message: "Failed to bulk create account masters", error: error.message });
  }
};

exports.getAccountMasterById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid AccountMaster ID" });
    }
    const { data: am, error } = await supabase.from("account_masters").select(AM_SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!am) {
      return res.status(404).json({ success: false, message: "AccountMaster not found" });
    }

    const responseData = {
      companyName: am.companyName.id,
      partyName: am.party.partyName,
      ownerName: am.party.ownerName,
      ownerMobileNo: am.party.ownerMobileNo,
      ownerWhatsAppNo: am.party.ownerWhatsAppNo,
      ownerEmail: am.party.ownerEmail || "",
      contactPerson: am.party.contactPerson,
      personMobileNo: am.party.personMobileNo,
      personWhatsAppNo: am.party.personWhatsAppNo,
      contactPersonEmail: am.party.contactPersonEmail || "",
      contactForPayment: am.party.contactForPayment,
      contactMobileNo: am.party.contactMobileNo,
      contactWhatsAppNo: am.party.contactWhatsAppNo,
      contactForPaymentEmail: am.party.contactForPaymentEmail || "",
      GSTNo: am.party.GSTNo,
      state: am.party.state,
      address: {
        unitNo: am.party.address?.unitNo,
        marketName: am.party.address?.marketName,
        streetAddress: am.party.address?.streetAddress,
        landMark: am.party.address?.landMark || "",
        area: am.party.address?.area,
        pincode: am.party.address?.pincode,
      },
      reasonToVisit: am.reasonToVisit,
      reference: am.reference || "",
      createdBy: am.createdBy?.id,
      createdById: am.createdBy?.id,
      companyNameObj: am.companyName,
      createdByObj: am.createdBy,
    };

    res.status(200).json({ success: true, data: responseData });
  } catch (error) {
    console.error("Error fetching account master:", error);
    res.status(500).json({ success: false, message: "Failed to fetch account master", error: error.message });
  }
};

exports.updateAccountMaster = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid AccountMaster ID" });
    }
    const { data: am } = await supabase.from("account_masters").select("id, party_id").eq("id", id).maybeSingle();
    if (!am) {
      return res.status(404).json({ success: false, message: "AccountMaster not found" });
    }
    if (!req.body.companyName || !req.body.reasonToVisit) {
      return res.status(400).json({ success: false, message: "Missing required fields: companyName or reasonToVisit" });
    }
    const { data: company } = await supabase.from("company_names").select("id").eq("id", req.body.companyName).maybeSingle();
    if (!company) {
      return res.status(400).json({ success: false, message: "Invalid companyName ID. Company does not exist." });
    }
    if (req.body.createdBy) {
      const { data: staff } = await supabase.from("staff").select("id").eq("id", req.body.createdBy).maybeSingle();
      if (!staff) {
        return res.status(400).json({ success: false, message: "Invalid createdBy ID. Staff member does not exist." });
      }
    }
    const emailRegex = /^\S+@\S+\.\S+$/;
    for (const f of ["ownerEmail", "contactPersonEmail", "contactForPaymentEmail"]) {
      if (req.body[f] && !emailRegex.test(req.body[f])) {
        return res.status(400).json({ success: false, message: `Invalid ${f} format` });
      }
    }

    const { data: currentParty } = await supabase.from("parties").select("status_approval").eq("id", am.party_id).single();

    const { error: partyErr } = await supabase
      .from("parties")
      .update({
        party_name: req.body.partyName,
        owner_name: req.body.ownerName,
        owner_mobile_no: req.body.ownerMobileNo,
        owner_whatsapp_no: req.body.ownerWhatsAppNo,
        owner_email: req.body.ownerEmail || null,
        contact_person: req.body.contactPerson,
        person_mobile_no: req.body.personMobileNo,
        person_whatsapp_no: req.body.personWhatsAppNo,
        contact_person_email: req.body.contactPersonEmail || null,
        contact_for_payment: req.body.contactForPayment,
        contact_mobile_no: req.body.contactMobileNo,
        contact_whatsapp_no: req.body.contactWhatsAppNo,
        contact_for_payment_email: req.body.contactForPaymentEmail || null,
        gst_no: req.body.GSTNo,
        state: req.body.state,
        address: req.body.address,
        status_approval: req.body.statusApproval || currentParty.status_approval,
        updated_at: new Date().toISOString(),
      })
      .eq("id", am.party_id);
    if (partyErr) throw partyErr;

    const { error: amErr } = await supabase
      .from("account_masters")
      .update({
        company_name_id: req.body.companyName,
        reason_to_visit: req.body.reasonToVisit,
        reference: req.body.reference,
        ...(req.body.createdBy && { created_by: req.body.createdBy }),
        updated_at: new Date().toISOString(),
        updated_by: req.user?.id || null,
      })
      .eq("id", id);
    if (amErr) throw amErr;

    const { data: populated } = await supabase.from("account_masters").select(AM_SELECT).eq("id", id).single();

    res.status(200).json({ success: true, message: "Account master updated successfully", data: withMongoId(populated) });
  } catch (error) {
    console.error("Error updating account master:", error);
    res.status(500).json({ success: false, message: "Failed to update account master", error: error.message });
  }
};

exports.updateAccountMasterStatus = async (req, res) => {
  try {
    if (!req.body.status) {
      return res.status(400).json({ success: false, message: "Status is required" });
    }
    const { data: updated, error } = await supabase.from("account_masters").select(AM_SELECT).eq("id", req.params.id).maybeSingle();
    if (error) throw error;
    if (!updated) {
      return res.status(404).json({ success: false, message: "Account master not found" });
    }

    const { data: latestTask } = await supabase
      .from("assign_tasks")
      .select("remarks, status, assign_to:assign_to(id, firstName:first_name, lastName:last_name, email)")
      .eq("party_name_id", updated.party.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const assignedTo = latestTask?.assign_to || updated.createdBy;
    const remarks = latestTask?.remarks || "NA";
    const status = latestTask?.status || req.body.status || "Not Started";

    res.status(200).json({
      success: true,
      message: "Account master status updated successfully",
      data: {
        _id: updated.id,
        companyName: updated.companyName,
        party: updated.party,
        reasonToVisit: updated.reasonToVisit,
        createdBy: updated.createdBy ? `${updated.createdBy.firstName} ${updated.createdBy.lastName}` : "",
        createdById: updated.createdBy?.id || null,
        assignedTo: assignedTo ? { _id: assignedTo.id, name: `${assignedTo.firstName} ${assignedTo.lastName}`, email: assignedTo.email } : null,
        remarks,
        status,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error updating account master status:", error);
    res.status(500).json({ success: false, message: "Failed to update account master status", error: error.message });
  }
};

exports.deleteAccountMaster = async (req, res) => {
  try {
    const { data: am } = await supabase.from("account_masters").select("id, party_id").eq("id", req.params.id).maybeSingle();
    if (!am) {
      return res.status(404).json({ success: false, message: "Account master not found" });
    }
    await supabase.from("account_masters").update({ is_delete: true }).eq("id", req.params.id);
    await supabase.from("parties").update({ is_delete: true }).eq("id", am.party_id);

    res.status(200).json({
      success: true,
      message: "Account master and associated party deleted successfully",
      deletedCounts: { accountMaster: 1, party: 1 },
    });
  } catch (error) {
    console.error("Error in deleteAccountMaster:", error);
    res.status(500).json({ success: false, message: "Failed to delete account master and party", error: error.message });
  }
};

exports.getAllStaff = async (req, res) => {
  try {
    const { data: staff, error } = await supabase.from("staff").select("id, firstName:first_name, lastName:last_name");
    if (error) throw error;
    res.status(200).json({ success: true, data: staff.map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}` })) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAccountMasterByCompanyAndParty = async (req, res) => {
  try {
    const { companyId, partyId } = req.body;
    if (!isValidId(companyId) || !isValidId(partyId)) {
      return res.status(400).json({ success: false, message: "Invalid ID format(s)" });
    }
    const { data: am, error } = await supabase
      .from("account_masters")
      .select(AM_SELECT)
      .eq("company_name_id", companyId)
      .eq("party_id", partyId)
      .maybeSingle();
    if (error) throw error;
    if (!am) {
      return res.status(404).json({ success: false, message: "No account found matching these company and party IDs" });
    }

    res.status(200).json({
      success: true,
      data: {
        accountMaster: {
          _id: am.id,
          reasonToVisit: am.reasonToVisit,
          createdAt: am.createdAt,
          updatedAt: am.updatedAt,
          company: am.companyName,
          party: am.party,
          createdBy: am.createdBy,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching account:", error);
    res.status(500).json({ success: false, message: "Failed to fetch account data", error: error.message });
  }
};

exports.approveParty = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid Party ID" });
    }
    const { data: party } = await supabase.from("parties").select("id, status_approval").eq("id", id).maybeSingle();
    if (!party) {
      return res.status(404).json({ success: false, message: "Party not found" });
    }
    if (party.status_approval === "Approved") {
      return res.status(400).json({ success: false, message: "Party is already approved" });
    }
    await supabase.from("parties").update({ status_approval: "Approved", updated_at: new Date().toISOString() }).eq("id", id);

    const { data: am } = await supabase.from("account_masters").select(AM_SELECT).eq("party_id", id).maybeSingle();

    res.status(200).json({ success: true, message: "Party approved successfully", data: withMongoId(am) });
  } catch (error) {
    console.error("Error approving party:", error);
    res.status(500).json({ success: false, message: "Failed to approve party", error: error.message });
  }
};

exports.getAccountMasterByStaffId = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid Staff ID" });
    }
    const { data: staff } = await supabase.from("staff").select("id").eq("id", id).maybeSingle();
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff member not found" });
    }

    const { data: accountMasters, error } = await supabase
      .from("account_masters")
      .select(AM_SELECT)
      .eq("created_by", id)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const enriched = await enrichWithLatestTask(withMongoId(accountMasters));

    res.status(200).json({ success: true, count: enriched.length, data: enriched });
  } catch (error) {
    console.error("Error fetching account masters by staff ID:", error);
    res.status(500).json({ success: false, message: "Failed to fetch account masters", error: error.message });
  }
};

exports.searchParties = async (req, res) => {
  try {
    const { q } = req.query;
    let query = supabase.from("parties").select(PARTY_SELECT).eq("is_delete", false).order("party_name", { ascending: true }).limit(20);
    if (q) query = query.ilike("party_name", `%${q}%`);
    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    console.error("Error searching parties:", error);
    res.status(500).json({ success: false, message: "Failed to search parties", error: error.message });
  }
};
