// Module 12: Delivery Management. A delivery challan supports partial
// deliveries against a sales order -- an order can have multiple challans
// over time (same pattern as GRN's partial receipt against a PO), each
// carrying its own quantity/vehicle/package/proof-of-delivery details.
// Orders in this app are single-product/single-qty rows (no line-items
// table), so unlike GRN/Purchase Return the insert itself needs no
// per-item RPC loop -- but the over-delivery guard does go through
// create_delivery_challan_transactional (Module 16 fix, see the note in
// createDeliveryChallan below) so it can lock the order row and close a
// check-then-insert race that used to let concurrent requests over-deliver.
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

    const { data: company } = await supabase.from("company_names").select("id, company_name").eq("id", order.company_name_id).maybeSingle();
    const initials = deriveInitials(company?.company_name);

    // Module 16 triage (audit-reconciliation.md's carried-forward
    // deliveryChallan.controller.js data-integrity flag): the over-delivery
    // guard used to be a plain JS check-then-insert (read existing challans'
    // sum, compare, then separately insert) with no locking and nothing
    // enforcing it at the DB level, so two concurrent requests against the
    // same order could both read the same "remaining" value, both pass, and
    // jointly over-deliver. create_delivery_challan_transactional closes
    // that race by locking the order row before computing/checking the
    // remaining quantity, so concurrent calls for the same order serialize
    // instead of racing -- same shape as this codebase's other
    // check-then-guard RPCs (create_order_transactional and friends), just
    // applied here for the first time to an already-shipped endpoint.
    const { data: challanId, error: rpcErr } = await supabase.rpc("create_delivery_challan_transactional", {
      p_order_id: orderId,
      p_company_name_id: order.company_name_id,
      p_party_id: order.party_id,
      p_quantity_delivered: Number(quantityDelivered),
      p_vehicle_number: vehicleNumber || null,
      p_vehicle_type: vehicleType || null,
      p_driver_name: driverName || null,
      p_driver_contact: driverContact || null,
      p_package_count: packageCount !== undefined && packageCount !== "" ? Number(packageCount) : null,
      p_package_weight: packageWeight !== undefined && packageWeight !== "" ? Number(packageWeight) : null,
      p_delivery_date: deliveryDate || null,
      p_notes: notes || null,
      p_created_by: req.user?.id || null,
      p_initials: initials,
    });
    if (rpcErr) {
      // The RPC's own over-delivery guard raises a plain Postgres exception
      // (not a distinct error code) -- match it by message so the client
      // still gets the same 400 + human-readable text it got from the old
      // JS-side check, instead of a generic 500.
      if (rpcErr.message && rpcErr.message.includes("remaining to deliver")) {
        return res.status(400).json({ success: false, message: rpcErr.message });
      }
      throw rpcErr;
    }

    const { data: created, error } = await supabase.from("delivery_challans").select(SELECT).eq("id", challanId).single();
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
