const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, deriveInitials } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

const SELECT = `
  id, rfqNumber:rfq_number, status, notes, createdAt:created_at, updatedAt:updated_at,
  companyName:company_name_id(id, companyName:company_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

const ITEM_SELECT = `id, materialId:material_id, quantityNeeded:quantity_needed, material:material_id(id, materialName:material_name, materialSize:material_size, materialGSM:material_gsm)`;

const QUOTE_SELECT = `
  id, status, createdAt:created_at, updatedAt:updated_at,
  vendor:vendor_id(id, name),
  items:rfq_vendor_quote_items(id, rate, notes, rfqItemId:rfq_item_id)
`;

// RFQ transitions: Draft -> Sent lets vendors start being quoted against;
// selecting a winning quote (see purchaseOrder.controller.js) is the only
// path to Closed, so it isn't listed here as a plain transition.
const ALLOWED_TRANSITIONS = {
  Draft: ["Sent", "Cancelled"],
  Sent: ["Cancelled"],
};

exports.createRfq = async (req, res) => {
  try {
    const { companyName, notes, items, vendorIds } = req.body;
    if (!isValidId(companyName)) {
      return res.status(400).json({ success: false, message: "Invalid company ID" });
    }
    const { data: company } = await supabase.from("company_names").select("id, company_name").eq("id", companyName).maybeSingle();
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }
    const materialIds = items.map((i) => i.materialId);
    const { data: materials } = await supabase.from("materials").select("id").in("id", materialIds).eq("is_delete", false);
    if (!materials || materials.length !== new Set(materialIds).size) {
      return res.status(404).json({ success: false, message: "One or more materials were not found" });
    }
    const { data: vendors } = await supabase.from("vendors").select("id").in("id", vendorIds).eq("is_delete", false);
    if (!vendors || vendors.length !== new Set(vendorIds).size) {
      return res.status(404).json({ success: false, message: "One or more vendors were not found" });
    }

    const initials = deriveInitials(company.company_name);

    const { data: rfqId, error } = await supabase.rpc("create_rfq_transactional", {
      p_company_name_id: companyName,
      p_notes: notes || null,
      p_created_by: req.user?.id || null,
      p_initials: initials,
      p_items: items.map((i) => ({ materialId: i.materialId, quantityNeeded: Number(i.quantityNeeded) })),
      p_vendor_ids: vendorIds,
    });
    if (error) throw error;

    const { data: populated } = await supabase.from("rfqs").select(SELECT).eq("id", rfqId).single();

    logAudit({ req, action: "create", module: "rfq", recordId: rfqId, newValue: populated });

    res.status(201).json({ success: true, message: "RFQ created successfully", data: withMongoId(populated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating RFQ: " + error.message });
  }
};

exports.getAllRfqs = async (req, res) => {
  try {
    const { status, search, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("rfqs").select(SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    if (search && String(search).trim()) query = query.ilike("rfq_number", `%${String(search).trim()}%`);
    // Multi-role audit fix (Finding 1): authorizeView() attaches this when the
    // caller's role only has view_own (not view_global) for this module.
    if (req.viewOwnFilter) query = query.eq(req.viewOwnFilter.column, req.viewOwnFilter.value);

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
    res.status(500).json({ success: false, message: "Error fetching RFQs: " + error.message });
  }
};

exports.getRfqById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid RFQ ID" });
    }
    const { data: rfq, error } = await supabase.from("rfqs").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!rfq) {
      return res.status(404).json({ success: false, message: "RFQ not found" });
    }
    const { data: items } = await supabase.from("rfq_items").select(ITEM_SELECT).eq("rfq_id", id);
    const { data: quotes } = await supabase.from("rfq_vendor_quotes").select(QUOTE_SELECT).eq("rfq_id", id);

    res.status(200).json({ success: true, data: withMongoId({ ...rfq, items: items || [], quotes: quotes || [] }) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching RFQ: " + error.message });
  }
};

exports.sendRfq = async (req, res) => {
  await doTransition(req, res, "Sent");
};

exports.cancelRfq = async (req, res) => {
  await doTransition(req, res, "Cancelled");
};

async function doTransition(req, res, toStatus) {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid RFQ ID" });
    }
    const { data: rfq } = await supabase.from("rfqs").select("id, status").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!rfq) {
      return res.status(404).json({ success: false, message: "RFQ not found" });
    }
    const allowed = ALLOWED_TRANSITIONS[rfq.status] || [];
    if (!allowed.includes(toStatus)) {
      return res.status(400).json({ success: false, message: `Cannot move an RFQ from '${rfq.status}' to '${toStatus}'` });
    }
    const { data, error } = await supabase
      .from("rfqs")
      .update({ status: toStatus, updated_by: req.user?.id || null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(SELECT)
      .single();
    if (error) throw error;

    logAudit({ req, action: "update", module: "rfq", recordId: id, newValue: { status: toStatus } });
    res.status(200).json({ success: true, message: `RFQ ${toStatus.toLowerCase()}`, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating RFQ status: " + error.message });
  }
}

exports.deleteRfq = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid RFQ ID" });
    }
    const { data, error } = await supabase.from("rfqs").update({ is_delete: true }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "RFQ not found" });
    }
    logAudit({ req, action: "delete", module: "rfq", recordId: id });
    res.status(200).json({ success: true, message: "RFQ deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting RFQ: " + error.message });
  }
};

// A vendor's quote can only be recorded/updated while the RFQ is Sent and
// this vendor was actually invited (row pre-created by create_rfq_transactional).
exports.recordVendorQuote = async (req, res) => {
  try {
    const { quoteId } = req.params;
    const { items } = req.body;
    if (!isValidId(quoteId)) {
      return res.status(400).json({ success: false, message: "Invalid quote ID" });
    }
    const { data: quote } = await supabase
      .from("rfq_vendor_quotes")
      .select("id, rfq_id, status, rfqs:rfq_id(status)")
      .eq("id", quoteId)
      .maybeSingle();
    if (!quote) {
      return res.status(404).json({ success: false, message: "Vendor quote invitation not found" });
    }
    if (quote.rfqs?.status !== "Sent") {
      return res.status(400).json({ success: false, message: "Quotes can only be recorded while the RFQ is Sent" });
    }
    if (quote.status === "Selected" || quote.status === "Not Selected") {
      return res.status(400).json({ success: false, message: "This RFQ has already been closed" });
    }
    const rfqItemIds = items.map((i) => i.rfqItemId);
    const { data: rfqItems } = await supabase.from("rfq_items").select("id").eq("rfq_id", quote.rfq_id).in("id", rfqItemIds);
    if (!rfqItems || rfqItems.length !== new Set(rfqItemIds).size) {
      return res.status(400).json({ success: false, message: "One or more rfqItemId values don't belong to this RFQ" });
    }

    const { error } = await supabase.rpc("record_vendor_quote_transactional", {
      p_rfq_vendor_quote_id: quoteId,
      p_items: items.map((i) => ({ rfqItemId: i.rfqItemId, rate: Number(i.rate), notes: i.notes || null })),
      p_updated_by: req.user?.id || null,
    });
    if (error) throw error;

    const { data: populated } = await supabase.from("rfq_vendor_quotes").select(QUOTE_SELECT).eq("id", quoteId).single();

    logAudit({ req, action: "update", module: "rfq", recordId: quoteId, newValue: populated });

    res.status(200).json({ success: true, message: "Vendor quote recorded", data: withMongoId(populated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error recording vendor quote: " + error.message });
  }
};
