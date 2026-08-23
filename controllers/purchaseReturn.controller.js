// Module 11 Part B: Purchase Return -- against a GRN's own line items,
// posts one outward inventory row per returned item (mirrors
// create_grn_transactional's one-inward-row-per-item pattern in reverse).
const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, deriveInitials, categoryForRole } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

const SELECT = `
  id, returnNumber:return_number, returnDate:return_date, reason, notes, createdAt:created_at,
  grn:grn_id(id, grnNumber:grn_number),
  vendor:vendor_id(id, name),
  companyName:company_name_id(id, companyName:company_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

const ITEM_SELECT = `
  id, quantityReturned:quantity_returned, rate, grnItemId:grn_item_id, inventoryId:inventory_id,
  material:material_id(id, materialName:material_name)
`;

exports.createPurchaseReturn = async (req, res) => {
  try {
    const { grnId, forRole, forCompany, returnDate, reason, notes, items } = req.body;
    if (!isValidId(grnId) || !isValidId(forRole) || !isValidId(forCompany)) {
      return res.status(400).json({ success: false, message: "Invalid grnId, forRole, or forCompany" });
    }

    const { data: grn } = await supabase.from("grns").select("id, vendor_id, company_name_id, grn_number").eq("id", grnId).eq("is_delete", false).maybeSingle();
    if (!grn) {
      return res.status(404).json({ success: false, message: "GRN not found" });
    }

    const { data: company } = await supabase.from("company_names").select("id, company_name").eq("id", grn.company_name_id).maybeSingle();
    const { data: roleRow } = await supabase.from("roles").select("id, role_name").eq("id", forRole).eq("is_delete", false).maybeSingle();
    if (!roleRow) {
      return res.status(404).json({ success: false, message: "Invalid or deleted role ID" });
    }
    const { data: staffRow } = await supabase.from("staff").select("id").eq("id", forCompany).maybeSingle();
    if (!staffRow) {
      return res.status(404).json({ success: false, message: "forCompany does not reference a valid staff member" });
    }

    const grnItemIds = items.map((i) => i.grnItemId);
    const { data: grnItems } = await supabase.from("grn_items").select("id, material_id, quantity_received, rate").eq("grn_id", grnId).in("id", grnItemIds);
    if (!grnItems || grnItems.length !== new Set(grnItemIds).size) {
      return res.status(400).json({ success: false, message: "One or more grnItemId values don't belong to this GRN" });
    }

    // A material can be returned at most once in total against a given GRN
    // line -- sum up whatever's already been returned against each line and
    // refuse to exceed what was actually received. There's no delete path
    // for a purchase return (it's a posted financial/inventory movement,
    // same as a GRN), so every row here is live.
    const { data: alreadyReturnedRows } = await supabase.from("purchase_return_items").select("grn_item_id, quantity_returned").in("grn_item_id", grnItemIds);
    const alreadyReturnedByItem = {};
    for (const row of alreadyReturnedRows || []) {
      alreadyReturnedByItem[row.grn_item_id] = (alreadyReturnedByItem[row.grn_item_id] || 0) + Number(row.quantity_returned);
    }

    for (const item of items) {
      const grnItem = grnItems.find((g) => g.id === item.grnItemId);
      const alreadyReturned = alreadyReturnedByItem[item.grnItemId] || 0;
      const remaining = Number(grnItem.quantity_received) - alreadyReturned;
      if (Number(item.quantityReturned) > remaining) {
        return res.status(400).json({
          success: false,
          message: `Cannot return ${item.quantityReturned} against a line with only ${remaining} returnable`,
        });
      }
    }

    const category = categoryForRole(roleRow.role_name);
    const initials = deriveInitials(company?.company_name);
    const { data: returnNumber, error: numErr } = await supabase.rpc("next_document_number", {
      p_doc_type: "purchase_return",
      p_initials: initials,
    });
    if (numErr) throw numErr;

    const { data: returnId, error } = await supabase.rpc("create_purchase_return_transactional", {
      p_grn_id: grnId,
      p_vendor_id: grn.vendor_id,
      p_company_name_id: grn.company_name_id,
      p_for_role_id: forRole,
      p_for_company_id: forCompany,
      p_return_date: returnDate || new Date().toISOString().slice(0, 10),
      p_reason: reason,
      p_notes: notes || null,
      p_created_by: req.user?.id || null,
      p_return_number: returnNumber,
      p_items: items.map((i) => {
        const grnItem = grnItems.find((g) => g.id === i.grnItemId);
        return {
          grnItemId: i.grnItemId,
          materialId: grnItem.material_id,
          quantityReturned: Number(i.quantityReturned),
          rate: Number(grnItem.rate),
          category,
        };
      }),
    });
    if (error) throw error;

    const { data: populated } = await supabase.from("purchase_returns").select(SELECT).eq("id", returnId).single();
    const { data: returnItems } = await supabase.from("purchase_return_items").select(ITEM_SELECT).eq("purchase_return_id", returnId);

    logAudit({ req, action: "create", module: "purchasereturn", recordId: returnId, newValue: populated });
    res.status(201).json({ success: true, message: "Purchase return posted successfully", data: withMongoId({ ...populated, items: returnItems || [] }) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating purchase return: " + error.message });
  }
};

exports.getAllPurchaseReturns = async (req, res) => {
  try {
    const { grnId, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;
    let query = supabase.from("purchase_returns").select(SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (grnId) query = query.eq("grn_id", grnId);

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
      response.pagination = { currentPage: pageNum, totalPages: Math.ceil(count / limitNum), totalCount: count, hasNext: from + data.length < count, hasPrev: pageNum > 1 };
    }
    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching purchase returns: " + error.message });
  }
};

exports.getPurchaseReturnById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid purchase return ID" });
    }
    const { data, error } = await supabase.from("purchase_returns").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Purchase return not found" });
    }
    const { data: items } = await supabase.from("purchase_return_items").select(ITEM_SELECT).eq("purchase_return_id", id);
    res.status(200).json({ success: true, data: withMongoId({ ...data, items: items || [] }) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching purchase return: " + error.message });
  }
};
