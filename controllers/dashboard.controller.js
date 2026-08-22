const supabase = require("../lib/supabaseClient");
const { withMongoId } = require("../lib/helpers");
const { computeCosting } = require("./costing.controller");

// Per the Module 6 design decision, the dashboard has no dedicated
// permission key -- every staff member sees the page, but each widget is
// included only when the caller's existing role permissions would already
// let them view that module's data (the same view_global/view_own flags
// authorizePermission() checks elsewhere), so the summary never leaks
// data a user couldn't otherwise reach.
function hasView(permissions, moduleKey) {
  const p = permissions?.[moduleKey];
  return !!(p && (p.view_global === true || p.view_own === true));
}

async function statusCounts(table) {
  const { data, error } = await supabase.from(table).select("status").eq("is_delete", false);
  if (error) throw error;
  const counts = {};
  for (const row of data || []) counts[row.status] = (counts[row.status] || 0) + 1;
  return counts;
}

exports.getDashboardSummary = async (req, res) => {
  try {
    const permissions = req.user?.roleData?.permissions || {};
    const summary = {};

    if (hasView(permissions, "quotation")) {
      summary.quotations = { byStatus: await statusCounts("quotations") };
    }
    if (hasView(permissions, "purchaseorder")) {
      summary.purchaseOrders = { byStatus: await statusCounts("purchase_orders") };
    }
    if (hasView(permissions, "jobcard")) {
      summary.jobCards = { byStatus: await statusCounts("job_cards") };
    }

    // Revenue is derived from Issued/Partially Paid/Paid invoices dated in
    // the current calendar month -- Cancelled invoices never count,
    // matching computeCosting's own revenue definition (Module 5).
    if (hasView(permissions, "invoice")) {
      const { data: invoices, error } = await supabase
        .from("invoices")
        .select("status, grandTotal:grand_total, invoiceDate:invoice_date")
        .eq("is_delete", false);
      if (error) throw error;

      const byStatus = {};
      for (const row of invoices || []) byStatus[row.status] = (byStatus[row.status] || 0) + 1;

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthlyRevenue = (invoices || [])
        .filter((inv) => inv.status !== "Cancelled" && inv.invoiceDate && new Date(inv.invoiceDate) >= monthStart)
        .reduce((sum, inv) => sum + Number(inv.grandTotal || 0), 0);

      summary.invoices = { byStatus, monthlyRevenue: Number(monthlyRevenue.toFixed(2)) };
    }

    // Same "who can approve what" eligibility rule as
    // approval.controller.js's getMyPendingApprovals -- a plain count here
    // rather than the full listing payload, since the widget only needs a
    // number.
    if (permissions.quotation?.approve === true || permissions.purchaseorder?.approve === true) {
      let pendingApprovalsCount = 0;
      if (permissions.quotation?.approve === true) {
        const { count } = await supabase.from("quotations").select("id", { count: "exact", head: true }).eq("status", "Pending Approval").eq("is_delete", false);
        pendingApprovalsCount += count || 0;
      }
      if (permissions.purchaseorder?.approve === true) {
        const { count } = await supabase.from("purchase_orders").select("id", { count: "exact", head: true }).eq("status", "Pending Approval").eq("is_delete", false);
        pendingApprovalsCount += count || 0;
      }
      summary.pendingApprovalsCount = pendingApprovalsCount;
    }

    // No reorder-level/threshold field exists anywhere on `materials`, so
    // rather than inventing an arbitrary "low stock" cutoff, this surfaces
    // the materials with the lowest current balance (same balance math as
    // stockLedger.controller.js#getSummary) -- an honest reading of the
    // data that exists, not a fabricated threshold.
    if (hasView(permissions, "inventory")) {
      const { data, error } = await supabase.from("inventories").select("material_id, type, quantity").eq("is_delete", false);
      if (error) throw error;
      const balances = {};
      for (const row of data || []) {
        const delta = row.type === "inward" ? Number(row.quantity) : -Number(row.quantity);
        balances[row.material_id] = (balances[row.material_id] || 0) + delta;
      }
      const materialIds = Object.keys(balances);
      let lowestStockMaterials = [];
      if (materialIds.length) {
        const { data: materials } = await supabase.from("materials").select("id, materialName:material_name").in("id", materialIds);
        lowestStockMaterials = (materials || [])
          .map((m) => ({ material: m, balance: balances[m.id] || 0 }))
          .sort((a, b) => a.balance - b.balance)
          .slice(0, 10);
      }
      summary.lowestStockMaterials = lowestStockMaterials;
    }

    // Profitability roll-up -- sums the same live-computed computeCosting
    // (Module 5) across every non-cancelled job card. This is the widget
    // Module 5 deliberately deferred as "more expensive to query"; the
    // user chose to include it anyway for Module 6.
    if (hasView(permissions, "costing")) {
      const { data: jobCards, error } = await supabase
        .from("job_cards")
        .select("id, order:order_id(id)")
        .eq("is_delete", false)
        .neq("status", "Cancelled");
      if (error) throw error;

      let totalRevenue = 0;
      let totalCost = 0;
      let totalProfit = 0;
      for (const jc of jobCards || []) {
        const costing = await computeCosting(jc);
        totalRevenue += costing.revenue;
        totalCost += costing.totalCost;
        totalProfit += costing.profit;
      }
      summary.profitability = {
        jobCardCount: (jobCards || []).length,
        totalRevenue: Number(totalRevenue.toFixed(2)),
        totalCost: Number(totalCost.toFixed(2)),
        totalProfit: Number(totalProfit.toFixed(2)),
        marginPct: totalRevenue > 0 ? Number(((totalProfit / totalRevenue) * 100).toFixed(2)) : null,
      };
    }

    res.status(200).json({ success: true, data: withMongoId(summary) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error building dashboard summary: " + error.message });
  }
};
