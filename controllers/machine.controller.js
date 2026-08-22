const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

const SELECT = `
  id, machineName:machine_name, machineCode:machine_code, category, capacity, status,
  purchaseDate:purchase_date, notes, createdAt:created_at, updatedAt:updated_at,
  companyName:company_name_id(id, companyName:company_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

exports.createMachine = async (req, res) => {
  try {
    const { machineName, machineCode, category, companyName, capacity, status, purchaseDate, notes } = req.body;
    if (!isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid ID format for companyName" });
    }
    const { data: company } = await supabase.from("company_names").select("id").eq("id", companyName).maybeSingle();
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }
    const { data: existing } = await supabase
      .from("machines")
      .select("id")
      .eq("company_name_id", companyName)
      .eq("machine_code", machineCode)
      .eq("is_delete", false)
      .maybeSingle();
    if (existing) {
      return res.status(400).json({ success: false, message: "A machine with this code already exists for this company" });
    }

    const { data, error } = await supabase
      .from("machines")
      .insert({
        machine_name: machineName,
        machine_code: machineCode,
        category,
        company_name_id: companyName,
        capacity: capacity || null,
        status: status || "Active",
        purchase_date: purchaseDate || null,
        notes: notes || null,
        created_by: req.user?.id || null,
      })
      .select(SELECT)
      .single();
    if (error) throw error;

    logAudit({ req, action: "create", module: "machine", recordId: data.id, newValue: data });

    res.status(201).json({ success: true, message: "Machine created successfully", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating machine: " + error.message });
  }
};

exports.getAllMachines = async (req, res) => {
  try {
    const { category, status, search, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("machines").select(SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (category) query = query.eq("category", category);
    if (status) query = query.eq("status", status);
    if (search && String(search).trim()) {
      query = query.ilike("machine_name", `%${String(search).trim()}%`);
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
    res.status(500).json({ success: false, message: "Error fetching machines: " + error.message });
  }
};

exports.getMachineById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid machine ID" });
    }
    const { data, error } = await supabase.from("machines").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Machine not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching machine: " + error.message });
  }
};

exports.updateMachine = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid machine ID" });
    }
    const { machineName, machineCode, category, companyName, capacity, status, purchaseDate, notes } = req.body;

    if (machineCode !== undefined) {
      const { data: existingRow } = await supabase.from("machines").select("company_name_id").eq("id", id).maybeSingle();
      const targetCompany = companyName !== undefined ? companyName : existingRow?.company_name_id;
      const { data: existing } = await supabase
        .from("machines")
        .select("id")
        .eq("company_name_id", targetCompany)
        .eq("machine_code", machineCode)
        .eq("is_delete", false)
        .neq("id", id)
        .maybeSingle();
      if (existing) {
        return res.status(400).json({ success: false, message: "A machine with this code already exists for this company" });
      }
    }

    const updateData = {
      ...(machineName !== undefined && { machine_name: machineName }),
      ...(machineCode !== undefined && { machine_code: machineCode }),
      ...(category !== undefined && { category }),
      ...(companyName !== undefined && { company_name_id: companyName }),
      ...(capacity !== undefined && { capacity }),
      ...(status !== undefined && { status }),
      ...(purchaseDate !== undefined && { purchase_date: purchaseDate }),
      ...(notes !== undefined && { notes }),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.id || null,
    };

    const { data, error } = await supabase.from("machines").update(updateData).eq("id", id).select(SELECT).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Machine not found" });
    }
    logAudit({ req, action: "update", module: "machine", recordId: id, newValue: data });
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating machine: " + error.message });
  }
};

exports.deleteMachine = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid machine ID" });
    }
    const { data, error } = await supabase.from("machines").update({ is_delete: true }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Machine not found" });
    }
    logAudit({ req, action: "delete", module: "machine", recordId: id });
    res.status(200).json({ success: true, message: "Machine deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting machine: " + error.message });
  }
};
