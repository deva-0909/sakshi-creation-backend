const supabase = require("../lib/supabaseClient");
const { withMongoId } = require("../lib/helpers");

// The only two modules with a real Pending Approval step today
// (quotation, purchaseOrder — see quotation.controller.js / purchaseOrder
// .controller.js's ALLOWED_TRANSITIONS). Invoice, RFQ, Job Card, and GRN
// have no approval gate; per the Module 6 design decision, extending the
// gate to them was explicitly out of scope, so there is nothing to list
// for them here.
const APPROVAL_MODULES = [
  {
    moduleKey: "quotation",
    table: "quotations",
    type: "quotation",
    select: `
      id, number:quotation_number, createdAt:created_at,
      companyName:company_name_id(id, companyName:company_name),
      party:party_id(id, partyName:party_name),
      createdBy:created_by(id, firstName:first_name, lastName:last_name)
    `,
    link: (id) => `/admin/quotation/view/${id}`,
  },
  {
    moduleKey: "purchaseorder",
    table: "purchase_orders",
    type: "purchaseOrder",
    select: `
      id, number:po_number, createdAt:created_at,
      companyName:company_name_id(id, companyName:company_name),
      vendor:vendor_id(id, name),
      createdBy:created_by(id, firstName:first_name, lastName:last_name)
    `,
    link: (id) => `/admin/procurement/purchase-orders/view/${id}`,
  },
];

// Cross-module inbox of everything sitting at Pending Approval that the
// logged-in staff member is entitled to approve. Reuses the exact
// permission the record's own module endpoint already enforces
// (roles.permissions[moduleKey].approve === true — same check
// authorizePermission() and lib/notify.js's getApprovers() make), just
// run for "this one caller" instead of "every staff member with the
// permission" — no new permission concept, no duplicated authorization
// logic.
exports.getMyPendingApprovals = async (req, res) => {
  try {
    const permissions = req.user?.roleData?.permissions || {};
    const eligibleModules = APPROVAL_MODULES.filter((m) => permissions[m.moduleKey]?.approve === true);

    const perModule = await Promise.all(
      eligibleModules.map(async (m) => {
        const { data, error } = await supabase
          .from(m.table)
          .select(m.select)
          .eq("status", "Pending Approval")
          .eq("is_delete", false)
          .order("created_at", { ascending: true });
        if (error) throw error;
        return (data || []).map((row) => ({
          type: m.type,
          moduleKey: m.moduleKey,
          id: row.id,
          number: row.number,
          createdAt: row.createdAt,
          companyName: row.companyName,
          party: row.party || null,
          vendor: row.vendor || null,
          createdBy: row.createdBy,
          link: m.link(row.id),
        }));
      })
    );

    const combined = perModule.flat().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    res.status(200).json({ success: true, count: combined.length, data: withMongoId(combined) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching pending approvals: " + error.message });
  }
};
