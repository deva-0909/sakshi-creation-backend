const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");

// Full Figma slide scan Phase 8 (Theme 7, deferred since Phase 4): Godown's
// box/cartoon receiving table (Slides 74-75) -- a receiving manifest
// (Box/Cartoon label, size, GSM, order, receipt date/pcs, vendor), not a
// material movement, so this is its own table rather than a category
// inside `inventories` (same reasoning dye_punches used). Surfaced inside
// Inventory > Godown as a tab, same as Dye/Punch is surfaced inside
// Inventory as a tab despite being its own module underneath.
const SELECT = `
  id, boxLabel:box_label, boxType:box_type, size, qty, gsm,
  dateOfOrder:date_of_order, receivedDate:received_date, receivedPcs:received_pcs,
  type, createdAt:created_at, updatedAt:updated_at,
  order:order_id(id, orderNumber:order_number),
  vendor:vendor_id(id, name),
  companyName:company_name_id(id, companyName:company_name)
`;

exports.createGodownBoxReceipt = async (req, res) => {
  try {
    const { boxLabel, boxType, size, qty, gsm, dateOfOrder, order, receivedDate, receivedPcs, vendor, type, companyName } = req.body;
    if (!boxLabel) {
      return res.status(400).json({ success: false, message: "Box/Cartoon label is required" });
    }
    if (order && !isValidId(order)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }
    if (vendor && !isValidId(vendor)) {
      return res.status(400).json({ success: false, message: "Invalid vendor ID" });
    }
    if (companyName && isValidId(companyName)) {
      const { data: company } = await supabase.from("company_names").select("id").eq("id", companyName).maybeSingle();
      if (!company) {
        return res.status(400).json({ success: false, message: `Invalid companyName ID: ${companyName}` });
      }
    }
    if (type && !["inward", "outward"].includes(type)) {
      return res.status(400).json({ success: false, message: "type must be 'inward' or 'outward'" });
    }

    const { data, error } = await supabase
      .from("godown_box_receipts")
      .insert({
        box_label: boxLabel,
        box_type: boxType || null,
        size: size || null,
        qty: qty !== undefined && qty !== "" ? qty : null,
        gsm: gsm !== undefined && gsm !== "" ? gsm : null,
        date_of_order: dateOfOrder || null,
        order_id: order || null,
        received_date: receivedDate || null,
        received_pcs: receivedPcs !== undefined && receivedPcs !== "" ? receivedPcs : null,
        vendor_id: vendor || null,
        type: type || "inward",
        company_name_id: companyName && isValidId(companyName) ? companyName : null,
        created_by: req.user?.id || null,
      })
      .select(SELECT)
      .single();
    if (error) throw error;

    logAudit({ req, action: "create", module: "godownBoxReceipt", recordId: data.id, newValue: data });

    res.status(201).json({ success: true, message: "Box/Cartoon receipt created successfully", data: withMongoId(data) });
  } catch (error) {
    console.error("Error creating godown box receipt:", error);
    res.status(500).json({ success: false, message: "Error creating box/cartoon receipt: " + error.message });
  }
};

exports.getAllGodownBoxReceipts = async (req, res) => {
  try {
    const { type, companyName } = req.query;

    let query = supabase
      .from("godown_box_receipts")
      .select(SELECT)
      .eq("is_delete", false)
      .order("created_at", { ascending: false });

    if (type && ["inward", "outward"].includes(type)) {
      query = query.eq("type", type);
    }
    // Same "own items + shared/unscoped" pattern as dye_punches and every
    // other company-scoped list filter added this track.
    if (companyName && isValidId(companyName)) {
      query = query.or(`company_name_id.is.null,company_name_id.eq.${companyName}`);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.status(200).json({ success: true, count: data.length, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching box/cartoon receipts: " + error.message });
  }
};

exports.getGodownBoxReceiptById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid box/cartoon receipt ID" });
    }
    const { data, error } = await supabase.from("godown_box_receipts").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Box/Cartoon receipt not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching box/cartoon receipt: " + error.message });
  }
};

exports.updateGodownBoxReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid box/cartoon receipt ID" });
    }
    const { boxLabel, boxType, size, qty, gsm, dateOfOrder, order, receivedDate, receivedPcs, vendor, type, companyName } = req.body;

    if (order !== undefined && order && !isValidId(order)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }
    if (vendor !== undefined && vendor && !isValidId(vendor)) {
      return res.status(400).json({ success: false, message: "Invalid vendor ID" });
    }
    if (type !== undefined && !["inward", "outward"].includes(type)) {
      return res.status(400).json({ success: false, message: "type must be 'inward' or 'outward'" });
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
      .from("godown_box_receipts")
      .update({
        ...(boxLabel !== undefined && { box_label: boxLabel }),
        ...(boxType !== undefined && { box_type: boxType || null }),
        ...(size !== undefined && { size: size || null }),
        ...(qty !== undefined && { qty: qty === "" ? null : qty }),
        ...(gsm !== undefined && { gsm: gsm === "" ? null : gsm }),
        ...(dateOfOrder !== undefined && { date_of_order: dateOfOrder || null }),
        ...(order !== undefined && { order_id: order || null }),
        ...(receivedDate !== undefined && { received_date: receivedDate || null }),
        ...(receivedPcs !== undefined && { received_pcs: receivedPcs === "" ? null : receivedPcs }),
        ...(vendor !== undefined && { vendor_id: vendor || null }),
        ...(type !== undefined && { type }),
        ...(companyName !== undefined && { company_name_id: companyNameUpdate }),
        updated_at: new Date().toISOString(),
        updated_by: req.user?.id || null,
      })
      .eq("id", id)
      .select(SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Box/Cartoon receipt not found" });
    }

    logAudit({ req, action: "update", module: "godownBoxReceipt", recordId: id, newValue: data });

    res.status(200).json({ success: true, message: "Box/Cartoon receipt updated successfully", data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating box/cartoon receipt: " + error.message });
  }
};

exports.deleteGodownBoxReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid box/cartoon receipt ID" });
    }
    const { data, error } = await supabase.from("godown_box_receipts").update({ is_delete: true }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Box/Cartoon receipt not found" });
    }
    logAudit({ req, action: "delete", module: "godownBoxReceipt", recordId: id });
    res.status(200).json({ success: true, message: "Box/Cartoon receipt deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting box/cartoon receipt: " + error.message });
  }
};
