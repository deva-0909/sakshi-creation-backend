const supabase = require("../lib/supabaseClient");

// Module 14: Reporting Depth. All 4 reports here are computed live from
// existing tables on every call -- same "no second, driftable source of
// truth" philosophy as Costing and Stock Ledger -- rather than snapshotted
// anywhere new.

const ORDER_REPORT_SELECT = `
  id, orderNumber:order_number, qty, status, expectedDeliveryDate:expected_delivery_date, createdAt:created_at,
  party:party_id(id, partyName:party_name),
  companyName:company_name_id(id, companyName:company_name),
  createdBy:created_by(id, firstName:first_name, lastName:last_name)
`;

// A job counts as "delayed" when it has an expected delivery date in the
// past, is not on Hold, and delivery_challans (Module 12's authoritative
// proof-of-delivery source) shows less than the full order quantity
// actually delivered -- orders.status alone can't answer this, since
// "Delivery" only means a delivery task was assigned, not that delivery
// happened (confirmed during design research: there is no terminal
// "Delivered" order status).
exports.getDelayedJobs = async (req, res) => {
  try {
    // Mobile/toggle/seed audit (2026-08-26), Phase C: this report previously
    // had no companyName param at all, so it always mixed both companies'
    // delayed jobs together.
    const { companyName } = req.query;
    const today = new Date().toISOString().slice(0, 10);
    let query = supabase
      .from("orders")
      .select(ORDER_REPORT_SELECT)
      .eq("is_delete", false)
      .neq("status", "Hold")
      .not("expected_delivery_date", "is", null)
      .lt("expected_delivery_date", today)
      .order("expected_delivery_date", { ascending: true });
    if (companyName) query = query.eq("company_name_id", companyName);
    const { data: orders, error } = await query;
    if (error) throw error;

    const orderIds = (orders || []).map((o) => o.id);
    let deliveredByOrder = {};
    if (orderIds.length) {
      const { data: challans } = await supabase
        .from("delivery_challans")
        .select("orderId:order_id, quantityDelivered:quantity_delivered")
        .in("order_id", orderIds)
        .eq("status", "Delivered")
        .eq("is_delete", false);
      deliveredByOrder = (challans || []).reduce((acc, c) => {
        acc[c.orderId] = (acc[c.orderId] || 0) + Number(c.quantityDelivered || 0);
        return acc;
      }, {});
    }

    const today_ms = Date.now();
    const rows = (orders || [])
      .map((o) => {
        const delivered = deliveredByOrder[o.id] || 0;
        const daysOverdue = Math.floor((today_ms - new Date(o.expectedDeliveryDate).getTime()) / 86400000);
        return { ...o, quantityDelivered: delivered, quantityRemaining: Math.max(o.qty - delivered, 0), daysOverdue };
      })
      .filter((o) => o.quantityRemaining > 0);

    res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching delayed jobs: " + error.message });
  }
};

// Per-party rollup: order volume, revenue (from Invoice.grand_total, same
// join Costing uses), and on-time delivery rate for orders that carry an
// expected delivery date.
exports.getCustomerPerformance = async (req, res) => {
  try {
    // Mobile/toggle/seed audit (2026-08-26), Phase C: companyName param
    // added -- previously always mixed both companies' orders/revenue.
    // Invoices aren't filtered by it directly (an invoice-only party, see
    // the missing-party backfill below, may have no matching order at all);
    // instead the byParty rollup itself is company-scoped by only ever
    // being seeded from this company's orders.
    const { companyName } = req.query;
    let ordersQuery = supabase
      .from("orders")
      .select("id, qty, expectedDeliveryDate:expected_delivery_date, party:party_id(id, partyName:party_name)")
      .eq("is_delete", false);
    if (companyName) ordersQuery = ordersQuery.eq("company_name_id", companyName);
    const { data: orders, error } = await ordersQuery;
    if (error) throw error;

    let invoicesQuery = supabase.from("invoices").select("partyId:party_id, grandTotal:grand_total").eq("is_delete", false).neq("status", "Cancelled");
    if (companyName) invoicesQuery = invoicesQuery.eq("company_name_id", companyName);
    const { data: invoices } = await invoicesQuery;

    const { data: challans } = await supabase
      .from("delivery_challans")
      .select("orderId:order_id, quantityDelivered:quantity_delivered, deliveryDate:delivery_date")
      .eq("status", "Delivered")
      .eq("is_delete", false);

    const deliveredByOrder = (challans || []).reduce((acc, c) => {
      if (!acc[c.orderId]) acc[c.orderId] = { qty: 0, lastDate: null };
      acc[c.orderId].qty += Number(c.quantityDelivered || 0);
      if (!acc[c.orderId].lastDate || c.deliveryDate > acc[c.orderId].lastDate) acc[c.orderId].lastDate = c.deliveryDate;
      return acc;
    }, {});

    const byParty = {};
    for (const o of orders || []) {
      if (!o.party) continue;
      const key = o.party.id;
      if (!byParty[key]) byParty[key] = { party: o.party, orderCount: 0, totalQty: 0, revenue: 0, onTimeCount: 0, trackedCount: 0 };
      byParty[key].orderCount += 1;
      byParty[key].totalQty += Number(o.qty || 0);
      if (o.expectedDeliveryDate) {
        const d = deliveredByOrder[o.id];
        if (d && d.qty >= o.qty) {
          byParty[key].trackedCount += 1;
          if (d.lastDate <= o.expectedDeliveryDate) byParty[key].onTimeCount += 1;
        }
      }
    }
    // Bug found during Module 16 triage (audit-reconciliation.md's carried-forward
    // "unverified data-integrity concern" in one of the 4 reporting endpoints):
    // invoice.controller.js's createInvoice only requires companyName+partyId --
    // orderId/quotationId are both optional -- so a party can have real,
    // Issued invoices with zero orders on file (an ad-hoc invoice, or every
    // one of its orders soft-deleted after the fact). byParty was only ever
    // seeded from `orders`, so that party's revenue -- and the party itself --
    // silently vanished from this report instead of showing up with $0
    // order volume. Backfill any invoice-only parties in before summing.
    const missingPartyIds = [...new Set((invoices || []).map((inv) => inv.partyId).filter((id) => id && !byParty[id]))];
    if (missingPartyIds.length) {
      const { data: extraParties } = await supabase.from("parties").select("id, partyName:party_name").in("id", missingPartyIds);
      (extraParties || []).forEach((p) => {
        byParty[p.id] = { party: p, orderCount: 0, totalQty: 0, revenue: 0, onTimeCount: 0, trackedCount: 0 };
      });
    }

    for (const inv of invoices || []) {
      if (byParty[inv.partyId]) byParty[inv.partyId].revenue += Number(inv.grandTotal || 0);
    }

    const rows = Object.values(byParty).map((r) => ({
      party: r.party,
      orderCount: r.orderCount,
      totalQty: r.totalQty,
      revenue: Number(r.revenue.toFixed(2)),
      onTimeDeliveryRatePct: r.trackedCount > 0 ? Number(((r.onTimeCount / r.trackedCount) * 100).toFixed(2)) : null,
    }));
    rows.sort((a, b) => b.revenue - a.revenue);

    res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching customer performance: " + error.message });
  }
};

// Per-salesperson rollup keyed by orders.created_by -- there's no
// dedicated salesperson field anywhere in the schema (confirmed during
// design research), so the staff member who logged the order stands in
// for it, same as every other "who owns this" question in this app.
exports.getSalespersonPerformance = async (req, res) => {
  try {
    // Mobile/toggle/seed audit (2026-08-26), Phase C: companyName param
    // added -- previously always mixed both companies' orders/revenue.
    // Invoices and the missing-order backfill below are filtered by the
    // same companyName so cross-company revenue can't leak in through
    // either path.
    const { companyName } = req.query;
    let ordersQuery = supabase
      .from("orders")
      .select("id, qty, partyId:party_id, createdBy:created_by(id, firstName:first_name, lastName:last_name)")
      .eq("is_delete", false);
    if (companyName) ordersQuery = ordersQuery.eq("company_name_id", companyName);
    const { data: orders, error } = await ordersQuery;
    if (error) throw error;

    let invoicesQuery = supabase.from("invoices").select("orderId:order_id, grandTotal:grand_total").eq("is_delete", false).neq("status", "Cancelled");
    if (companyName) invoicesQuery = invoicesQuery.eq("company_name_id", companyName);
    const { data: invoices } = await invoicesQuery;
    const revenueByOrder = (invoices || []).reduce((acc, inv) => {
      acc[inv.orderId] = (acc[inv.orderId] || 0) + Number(inv.grandTotal || 0);
      return acc;
    }, {});

    const byStaff = {};
    const orderIdsSeen = new Set();
    for (const o of orders || []) {
      orderIdsSeen.add(o.id);
      if (!o.createdBy) continue;
      const key = o.createdBy.id;
      if (!byStaff[key]) byStaff[key] = { staff: o.createdBy, orderCount: 0, totalQty: 0, revenue: 0, partySet: new Set() };
      byStaff[key].orderCount += 1;
      byStaff[key].totalQty += Number(o.qty || 0);
      byStaff[key].revenue += revenueByOrder[o.id] || 0;
      if (o.partyId) byStaff[key].partySet.add(o.partyId);
    }

    // Same bug class as getCustomerPerformance above: deleteOrder has no
    // guard against soft-deleting an order that's already been invoiced, so
    // an invoice's order_id can point at an order missing from the live
    // `orders` fetch above -- that revenue would otherwise silently vanish
    // from every salesperson's total instead of staying attributed to
    // whoever created the now-deleted order. Deliberately not touching
    // orderCount/totalQty/distinctCustomers for these -- those describe
    // *current* live order volume, not revenue history.
    const missingOrderIds = [...new Set((invoices || []).map((inv) => inv.orderId).filter((id) => id && !orderIdsSeen.has(id)))];
    if (missingOrderIds.length) {
      const { data: extraOrders } = await supabase
        .from("orders")
        .select("id, createdBy:created_by(id, firstName:first_name, lastName:last_name)")
        .in("id", missingOrderIds);
      for (const o of extraOrders || []) {
        if (!o.createdBy) continue;
        const key = o.createdBy.id;
        if (!byStaff[key]) byStaff[key] = { staff: o.createdBy, orderCount: 0, totalQty: 0, revenue: 0, partySet: new Set() };
        byStaff[key].revenue += revenueByOrder[o.id] || 0;
      }
    }

    const rows = Object.values(byStaff)
      .map((r) => ({
        staff: r.staff,
        orderCount: r.orderCount,
        totalQty: r.totalQty,
        revenue: Number(r.revenue.toFixed(2)),
        distinctCustomers: r.partySet.size,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching salesperson performance: " + error.message });
  }
};

// Purchase rate history has three independent, differently-shaped
// sources (confirmed during design research): the legacy flat
// purchases.rate_per_sheet flow, purchase_order_items.rate (dated via its
// parent purchase_orders), and grn_items.rate (dated via its parent
// grns.received_date). Normalized here into one (materialId, rate, date,
// source) timeline per material rather than picking just one source.
exports.getPurchaseRateTrend = async (req, res) => {
  try {
    const { materialId } = req.query;

    let purchasesQuery = supabase.from("purchases").select("materialId:material_id, rate:rate_per_sheet, date:created_at").eq("is_delete", false);
    if (materialId) purchasesQuery = purchasesQuery.eq("material_id", materialId);
    const { data: purchases } = await purchasesQuery;

    let poItemsQuery = supabase.from("purchase_order_items").select("materialId:material_id, rate, purchaseOrder:purchase_order_id(createdAt:created_at)");
    if (materialId) poItemsQuery = poItemsQuery.eq("material_id", materialId);
    const { data: poItems } = await poItemsQuery;

    let grnItemsQuery = supabase.from("grn_items").select("materialId:material_id, rate, grn:grn_id(receivedDate:received_date)");
    if (materialId) grnItemsQuery = grnItemsQuery.eq("material_id", materialId);
    const { data: grnItems } = await grnItemsQuery;

    const rows = [
      ...(purchases || [])
        .filter((p) => p.rate !== null && p.rate !== undefined)
        .map((p) => ({ materialId: p.materialId, rate: Number(p.rate), date: p.date, source: "purchase" })),
      ...(poItems || [])
        .filter((p) => p.rate !== null && p.rate !== undefined && p.purchaseOrder?.createdAt)
        .map((p) => ({ materialId: p.materialId, rate: Number(p.rate), date: p.purchaseOrder.createdAt, source: "purchase_order" })),
      ...(grnItems || [])
        .filter((g) => g.rate !== null && g.rate !== undefined && g.grn?.receivedDate)
        .map((g) => ({ materialId: g.materialId, rate: Number(g.rate), date: g.grn.receivedDate, source: "grn" })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    const materialIds = [...new Set(rows.map((r) => r.materialId))];
    let materialsById = {};
    if (materialIds.length) {
      const { data: materials } = await supabase.from("materials").select("id, materialName:material_name").in("id", materialIds);
      materialsById = (materials || []).reduce((acc, m) => ({ ...acc, [m.id]: m }), {});
    }

    const enriched = rows.map((r) => ({ ...r, material: materialsById[r.materialId] || null }));

    res.status(200).json({ success: true, count: enriched.length, data: enriched });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching purchase rate trend: " + error.message });
  }
};
