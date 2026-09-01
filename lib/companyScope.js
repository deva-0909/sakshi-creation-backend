const supabase = require("./supabaseClient");

// Tier 1 security audit fix (2026-09-01), Fix 1: several list/summary
// controllers (getAllOrders, getAllAccountMasters, getAllInvoices,
// getInventoryByCategory, getInventorySummary) only filter by
// company_name_id when the caller passes an explicit `companyName` query
// param -- with no fallback to the caller's own company when it's absent.
// That's exactly what happens on a single-company-scoped role's (Sales,
// Store, ...) very first login: CompanyToggle.tsx defaults activeCompanyId
// to "" ("All companies") on a genuinely first-ever visit, and the same
// "" is sent again if that role deliberately clicks "All companies" --
// either way these endpoints today return every company's rows.
//
// Patch 126 correction: the first version of this fix used
// setup.company-name.view_global as the "sees every company" signal.
// That's wrong -- Viewer's role has view_global:true on almost every
// module, including setup.company-name, as part of its blanket
// read-everything grant (confirmed live), even though Viewer
// (client.viewer@sakshicreation.com) is exactly the kind of
// single-company, client-facing account this fix exists to protect. Using
// that flag would have silently exempted Viewer from the company
// fallback and left the original cross-company leak in place for it.
//
// Correct signal: staff.controller.js's loginStaff signs the plain role
// NAME straight into the JWT (`{ id, role: staff.role?.roleName,
// roleData }`) -- req.user.role is a literal string like "Admin", not a
// permission flag any role can be granted a subset of. Only the "Admin"
// role is meant to see every company; every other seeded role (Sales,
// Procurement, Production, Accounts, Store, Viewer, Godown Manager) is
// scoped to exactly one company_name_id on its own staff row. Checking
// the role name directly avoids relying on any particular permission
// flag happening to be false for every non-Admin role today, which is a
// much easier invariant to accidentally break later than "the Admin role
// is the multi-company one."
//
// company_name_id itself is NOT in the JWT at all (loginStaff only signs
// { id, role, roleData } -- see staff.controller.js), so the caller's own
// company still has to be read live from the staff table.
//
// Returns:
//   { scoped: false }                     -- caller may see all companies;
//                                             controller applies no extra filter.
//   { scoped: true, companyId: "<uuid>" }  -- controller must
//                                             .eq("company_name_id", companyId).
//   { scoped: true, companyId: null }      -- single-company role whose own
//                                             company_name_id is unset (should
//                                             not normally happen) -- controller
//                                             should treat this the same as
//                                             companyId, i.e. .eq(...) against
//                                             null, which yields an empty
//                                             result rather than "all rows".
async function resolveCompanyScope(req) {
  // Patch 126: role NAME, not a permission flag -- see the file comment
  // above for why. Only "Admin" is exempt from the company fallback.
  if (req.user?.role === "Admin") return { scoped: false };

  const userId = req.user?.id;
  if (!userId) return { scoped: false }; // defensive; authenticateToken already guarantees this is set

  try {
    const { data, error } = await supabase.from("staff").select("company_name_id").eq("id", userId).maybeSingle();
    if (error || !data) {
      // Fail open to pre-fix (unscoped) behavior on a transient lookup
      // failure -- matches resolvePermissions()'s own fallback convention
      // in middleware/authorize.js rather than 500ing every list page.
      console.error("resolveCompanyScope: staff lookup failed, not applying company fallback:", error?.message);
      return { scoped: false };
    }
    return { scoped: true, companyId: data.company_name_id || null };
  } catch (e) {
    console.error("resolveCompanyScope: staff lookup threw, not applying company fallback:", e.message);
    return { scoped: false };
  }
}

module.exports = { resolveCompanyScope };
