const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

// Two-company Phase 2 Part A (claude/two-company-gap-analysis.md): the
// "Dye / Punch" inventory tab from the Figma reference -- a die-cutting
// tooling register, not a material movement (see the dye_punches
// migration comment for why this is its own table rather than a new
// `inventories` category).
const SELECT = `
  id, dyePunchNumber:dye_punch_number, type, size, ply, sheetSize:sheet_size, boxSize:box_size, kantan, kantanType:kantan_type, remarks,
  createdAt:created_at, updatedAt:updated_at,
  party:party_id(id, partyName:party_name),
  companyName:company_name_id(id, companyName:company_name)
`;

exports.createDyePunch = async (req, res) => {
  try {
    const { dyePunchNumber, type, party, size, ply, sheetSize, boxSize, kantan, kantanType, remarks, companyName } = req.body;
    if (!dyePunchNumber) {
      return res.status(400).json({ success: false, message: "Dye/Punch number is required" });
    }
    if (party && !isValidId(party)) {
      return res.status(400).json({ success: false, message: "Invalid party ID" });
    }
    if (companyName && isValidId(companyName)) {
      const { data: company } = await supabase.from("company_names").select("id").eq("id", companyName).maybeSingle();
      if (!company) {
        return res.status(400).json({ success: false, message: `Invalid companyName ID: ${companyName}` });
      }
    }

    const { data, error } = await supabase
      .from("dye_punches")
      .insert({
        dye_punch_number: dyePunchNumber,
        type: type || "Regular",
        party_id: party || null,
        size: size || null,
        ply: ply || null,
        sheet_size: sheetSize || null,
        box_size: boxSize || null,
        kantan: kantan || null,
        kantan_type: kantanType || null,
        remarks: remarks || null,
        company_name_id: companyName && isValidId(companyName) ? companyName : null,
        created_by: req.user?.id || null,
      })
      .select(SELECT)
      .single();
    if (error) throw error;

    logAudit({ req, action: "create", module: "dyePunch", recordId: data.id, newValue: data });

    res.status(201).json({ success: true, message: "Dye/Punch created successfully", data: withMongoId(data) });
  } catch (error) {
    console.error("Error creating dye/punch:", error);
    res.status(500).json({ success: false, message: "Error creating dye/punch: " + error.message });
  }
};

exports.getAllDyePunches = async (req, res) => {
  try {
    const { page, limit, search, companyName } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase
      .from("dye_punches")
      .select(SELECT, { count: "exact" })
      .eq("is_delete", false)
      .order("created_at", { ascending: false });

    // Same "own items + shared/unscoped" pattern as product_items (Phase
    // 1) and every other company-scoped list filter added this track.
    if (companyName && isValidId(companyName)) {
      query = query.or(`company_name_id.is.null,company_name_id.eq.${companyName}`);
    }
    if (search && String(search).trim()) {
      query = query.ilike("dye_punch_number", `%${String(search).trim()}%`);
    }

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
    res.status(500).json({ success: false, message: "Error fetching dye/punches: " + error.message });
  }
};

exports.getDyePunchById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid dye/punch ID" });
    }
    const { data, error } = await supabase.from("dye_punches").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Dye/Punch not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching dye/punch: " + error.message });
  }
};

exports.updateDyePunch = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid dye/punch ID" });
    }
    const { dyePunchNumber, type, party, size, ply, sheetSize, boxSize, kantan, kantanType, remarks, companyName } = req.body;

    if (party !== undefined && party && !isValidId(party)) {
      return res.status(400).json({ success: false, message: "Invalid party ID" });
    }
    let companyNameUpdate;
    if (companyName !== undefined) {
      if (!companyName) {
        companyNameUpdate = null;
      } else if (isValidId(companyName)) {
        const { data: company } = await supabase.from("company_names").select("id").eq("id", companyName).maybeSingle();
        if (!company) {
          return res.status(400).json({ success: false, message: `Invalid companyName ID: ${companyName}` });
        }
        companyNameUpdate = companyName;
      } else {
        return res.status(400).json({ success: false, message: `Invalid companyName ID: ${companyName}` });
      }
    }

    const { data, error } = await supabase
      .from("dye_punches")
      .update({
        ...(dyePunchNumber !== undefined && { dye_punch_number: dyePunchNumber }),
        ...(type !== undefined && { type }),
        ...(party !== undefined && { party_id: party || null }),
        ...(size !== undefined && { size }),
        ...(ply !== undefined && { ply }),
        ...(sheetSize !== undefined && { sheet_size: sheetSize }),
        ...(boxSize !== undefined && { box_size: boxSize }),
        ...(kantan !== undefined && { kantan }),
        ...(kantanType !== undefined && { kantan_type: kantanType }),
        ...(remarks !== undefined && { remarks }),
        ...(companyName !== undefined && { company_name_id: companyNameUpdate }),
        updated_at: new Date().toISOString(),
        updated_by: req.user?.id || null,
      })
      .eq("id", id)
      .select(SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Dye/Punch not found" });
    }

    logAudit({ req, action: "update", module: "dyePunch", recordId: id, newValue: data });

    res.status(200).json({ success: true, message: "Dye/Punch updated successfully", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating dye/punch: " + error.message });
  }
};

exports.deleteDyePunch = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid dye/punch ID" });
    }
    const { data, error } = await supabase.from("dye_punches").update({ is_delete: true }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Dye/Punch not found" });
    }
    logAudit({ req, action: "delete", module: "dyePunch", recordId: id });
    res.status(200).json({ success: true, message: "Dye/Punch deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting dye/punch: " + error.message });
  }
};
