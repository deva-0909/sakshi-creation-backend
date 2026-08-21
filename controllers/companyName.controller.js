const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");

const SELECT_BASIC = "id, companyName:company_name, avatar, createdAt:created_at, updatedAt:updated_at";

exports.createCompanyName = async (req, res) => {
  try {
    if (!req.body.companyName) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: companyName",
      });
    }

    const { data: existing } = await supabase
      .from("company_names")
      .select("id")
      .eq("company_name", req.body.companyName)
      .eq("is_delete", false)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Company name already exists",
      });
    }

    const { data, error } = await supabase
      .from("company_names")
      .insert({
        company_name: req.body.companyName,
        avatar: req.body.avatar || null,
      })
      .select(SELECT_BASIC)
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: "Company name created successfully",
      data: withMongoId(data),
    });
  } catch (error) {
    console.error("Error creating company name:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create company name",
      error: error.message,
    });
  }
};

exports.getAllCompanyNames = async (req, res) => {
  try {
    const { page, limit, search } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase
      .from("company_names")
      .select(SELECT_BASIC, { count: "exact" })
      .eq("is_delete", false)
      .order("created_at", { ascending: false });

    if (search && String(search).trim()) {
      query = query.ilike("company_name", `%${String(search).trim()}%`);
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

    const response = { success: true, data: withMongoId(data) };
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
    console.error("Error fetching company names:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch company names",
      error: error.message,
    });
  }
};

exports.getCompanyNames = async (req, res) => {
  try {
    const { data: companies, error } = await supabase
      .from("company_names")
      .select(SELECT_BASIC)
      .eq("is_delete", false);
    if (error) throw error;

    const withParties = await Promise.all(
      companies.map(async (c) => {
        const { data: partyList } = await supabase
          .from("account_masters")
          .select("id")
          .eq("company_name_id", c.id);
        return { ...withMongoId(c), partyList: partyList || [] };
      })
    );

    res.status(200).json({ success: true, data: withParties });
  } catch (error) {
    console.error("Error fetching company names:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch company names",
      error: error.message,
    });
  }
};

exports.getCompanyNameById = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("company_names")
      .select(SELECT_BASIC)
      .eq("id", req.params.id)
      .eq("is_delete", false)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Company name not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    console.error("Error fetching company name:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch company name",
      error: error.message,
    });
  }
};

exports.updateCompanyName = async (req, res) => {
  try {
    if (req.body.companyName) {
      const { data: existing } = await supabase
        .from("company_names")
        .select("id")
        .eq("company_name", req.body.companyName)
        .eq("is_delete", false)
        .neq("id", req.params.id)
        .maybeSingle();
      if (existing) {
        return res.status(400).json({ success: false, message: "Company name already in use" });
      }
    }

    const updateData = {
      ...(req.body.companyName && { company_name: req.body.companyName }),
      ...(req.body.avatar && { avatar: req.body.avatar }),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("company_names")
      .update(updateData)
      .eq("id", req.params.id)
      .select(SELECT_BASIC)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Company name not found" });
    }

    res.status(200).json({
      success: true,
      message: "Company name updated successfully",
      data: withMongoId(data),
    });
  } catch (error) {
    console.error("Error updating company name:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update company name",
      error: error.message,
    });
  }
};

exports.deleteCompanyName = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("company_names")
      .update({ is_delete: true })
      .eq("id", req.params.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Company name not found" });
    }
    res.status(200).json({ success: true, message: "Company name deleted successfully" });
  } catch (error) {
    console.error("Error deleting company name:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete company name",
      error: error.message,
    });
  }
};

exports.getPartywithCompany = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid company ID format" });
    }

    const { data: accountMasters, error } = await supabase
      .from("account_masters")
      .select(
        "party:parties!inner(id, partyName:party_name, statusApproval:status_approval, address)"
      )
      .eq("company_name_id", id)
      .eq("parties.status_approval", "Approved");

    if (error) throw error;

    const parties = (accountMasters || [])
      .filter((a) => a.party)
      .map((a) => ({
        _id: a.party.id,
        partyName: a.party.partyName,
        unitNo: a.party.address?.unitNo,
        marketName: a.party.address?.marketName,
      }))
      .sort((a, b) => (a.partyName || "").localeCompare(b.partyName || ""));

    res.status(200).json({
      success: true,
      data: parties,
      count: parties.length,
      message:
        parties.length > 0
          ? "Approved parties fetched successfully"
          : "No approved parties found for this company",
    });
  } catch (error) {
    console.error("Error fetching approved parties by company:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch approved parties for the company",
      error: error.message,
    });
  }
};
