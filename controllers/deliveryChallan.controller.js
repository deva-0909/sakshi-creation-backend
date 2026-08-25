// Module 12: Delivery Management. A delivery challan supports partial
// deliveries against a sales order -- an order can have multiple challans
// over time (same pattern as GRN's partial receipt against a PO), each
// carrying its own quantity/vehicle/package/proof-of-delivery details.
// Orders in this app are single-product/single-qty rows (no line-items
// table), so unlike GRN/Purchase Return there's no per-item RPC needed --
// a plain validated insert is enough.
const supabase = require("../lib/supabaseClient");
const { isValidId, withMongoId, deriveInitials } = require("../lib/helpers");
const { logAudit } = require("../lib/audit");
const { buildDeliveryChallanPdf, streamPdf } = require("../lib/pdf");

const SELECT = `
  id, challanNumber:challan_number, quantityDelivered:quantity_delivered,
  vehicleNumber:vehicle_number, vehicleType:vehicle_type, driverName:driver_name, driverContact:driver_contact,
  packageCount:package_count, packageWeight:package_weight, deliveryDate:delivery_date, status, notes,
  podReceivedBy:pod_received_by, podDesignation:pod_designation, podReceivedAt:pod_received_at,
  podNotes:pod_notes, podSignatureUrl:pod_signature_url,
  createdAt:created_at, updatedAt:updated_at,
  order:order_id(id, orderNumber:order_number, qty, customerPoNumber:customer_po_number, priority),
  companyName:company_name_id(id, companyName:company_name),
  party:party_id(id, partyName:party_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

const ACTIVE_STATUSES = ["Dispatched", "Delivered"];

exports.createDeliveryChallan = async (req, res) => {
  try {
    const { orderId, quantityDelivered, vehicleNumber, vehicleType, driverName, driverContact, packageCount, packageWeight, deliveryDate, notes } = req.body;
    if (!isValidId(orderId)) {
      return res.status(400).json({ success: false, message: "Invalid orderId" });
    }

    const { data: order } = await supabase
      .from("orders")
      .select("id, order_number, qty, company_name_id, party_id")
      .eq("id", orderId)
      .eq("is_delete", false)
      .maybeSingle();
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const { data: existingChallans } = await supabase
      .from("delivery_challans")
      .select("quantity_delivered")
      .eq("order_id", orderId)
      .eq("is_delete", false)
      .in("status", ACTIVE_STATUSES);
    const alreadyDelivered = (existingChallans || []).reduce((sum, c) => sum + Number(c.quantity_delivered), 0);
    const remaining = Number(order.qty) - alreadyDelivered;
    if (Number(quantityDelivered) > remaining) {
      return res.status(400).json({
        success: false,
        message: `Cannot deliver ${quantityDelivered} against an order with only ${remaining} remaining to deliver`,
      });
    }

    const { data: company } = await supabase.from("company_names").select("id, company_name").eq("id", order.company_name_id).maybeSingle();
    const initials = deriveInitials(company?.company_name);
    const { data: challanNumber, error: numErr } = await supabase.rpc("next_document_number", {
      p_doc_type: "delivery_challan",
      p_initials: initials,
    });
    if (numErr) throw numErr;

    const insertPayload = {
      challan_number: challanNumber,
      order_id: orderId,
      company_name_id: order.company_name_id,
      party_id: order.party_id,
      quantity_delivered: Number(quantityDelivered),
      vehicle_number: vehicleNumber || null,
      vehicle_type: vehicleType || null,
      driver_name: driverName || null,
      driver_contact: driverContact || null,
      package_count: packageCount !== undefined && packageCount !== "" ? Number(packageCount) : null,
      package_weight: packageWeight !== undefined && packageWeight !== "" ? Number(packageWeight) : null,
      delivery_date: deliveryDate || new Date().toISOString().slice(0, 10),
      notes: notes || null,
      created_by: req.user?.id || null,
    };

    const { data: created, error } = await supabase.from("delivery_challans").insert(insertPayload).select(SELECT).single();
    if (error) throw error;

    logAudit({ req, action: "create", module: "deliverychallan", recordId: created.id, newValue: created });
    res.status(201).json({ success: true, message: "Delivery challan created successfully", data: withMongoId(created) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating delivery challan: " + error.message });
  }
};

exports.getAllDeliveryChallans = async (req, res) => {
  try {
    const { orderId, status, companyName, search, page, limit } = req.query;
    const paginate = page !== undefined || limit !== undefined;

    let query = supabase.from("delivery_challans").select(SELECT, { count: "exact" }).eq("is_delete", false).order("created_at", { ascending: false });
    if (orderId && isValidId(orderId)) query = query.eq("order_id", orderId);
    if (status) query = query.eq("status", status);
    // QP order-process audit (2026-08-25): same companyName list-filter gap
    // fix as invoice.controller.js -- see that file's comment.
    if (companyName) query = query.eq("company_name_id", companyName);
    if (search && String(search).trim()) query = query.ilike("challan_number", `%${String(search).trim()}%`);

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
    res.status(500).json({ success: false, message: "Error fetching delivery challans: " + error.message });
  }
};

exports.getDeliveryChallanById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid delivery challan ID" });
    }
    const { data, error } = await supabase.from("delivery_challans").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: "Delivery challan not found" });
    }
    res.status(200).json({ success: true, data: withMongoId(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching delivery challan: " + error.message });
  }
};

// Proof of delivery is captured once, moving the challan Dispatched ->
// Delivered. Not modeled as a generic status-transition map (only one
// legal transition exists here) -- a dedicated endpoint mirroring the
// same "status change with side-effect data" pattern as GRN posting.
exports.recordProofOfDelivery = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid delivery challan ID" });
    }
    const { podReceivedBy, podDesignation, podNotes, podSignatureUrl } = req.body;

    const { data: existing } = await supabase.from("delivery_challans").select("id, status").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!existing) {
      return res.status(404).json({ success: false, message: "Delivery challan not found" });
    }
    if (existing.status !== "Dispatched") {
      return res.status(400).json({ success: false, message: `Cannot record proof of delivery for a challan in '${existing.status}' status` });
    }

    const { data: updated, error } = await supabase
      .from("delivery_challans")
      .update({
        status: "Delivered",
        pod_received_by: podReceivedBy,
        pod_designation: podDesignation || null,
        pod_received_at: new Date().toISOString(),
        pod_notes: podNotes || null,
        pod_signature_url: podSignatureUrl || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(SELECT)
      .single();
    if (error) throw error;

    logAudit({ req, action: "update", module: "deliverychallan", recordId: id, newValue: updated });
    res.status(200).json({ success: true, message: "Proof of delivery recorded", data: withMongoId(updated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error recording proof of delivery: " + error.message });
  }
};

exports.getDeliveryChallanPdf = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid delivery challan ID" });
    }
    const { data: challan, error } = await supabase.from("delivery_challans").select(SELECT).eq("id", id).eq("is_delete", false).maybeSingle();
    if (error) throw error;
    if (!challan) {
      return res.status(404).json({ success: false, message: "Delivery challan not found" });
    }
    const doc = await buildDeliveryChallanPdf(challan);
    streamPdf(res, doc, `${challan.challanNumber}.pdf`);
  } catch (error) {
    res.status(500).json({ success: false, message: "Error generating delivery challan PDF: " + error.message });
  }
};

exports.cancelDeliveryChallan = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid delivery challan ID" });
    }
    const { remarks } = req.body;

    const { data: existing } = await supabase.from("delivery_challans").select("id, status").eq("id", id).eq("is_delete", false).maybeSingle();
    if (!existing) {
      return res.status(404).json({ success: false, message: "Delivery challan not found" });
    }
    if (existing.status !== "Dispatched") {
      return res.status(400).json({ success: false, message: `Cannot cancel a challan in '${existing.status}' status` });
    }

    const { data: updated, error } = await supabase
      .from("delivery_challans")
      .update({ status: "Cancelled", notes: remarks, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(SELECT)
      .single();
    if (error) throw error;

    logAudit({ req, action: "update", module: "deliverychallan", recordId: id, newValue: updated });
    res.status(200).json({ success: true, message: "Delivery challan cancelled", data: withMongoId(updated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error cancelling delivery challan: " + error.message });
  }
};
