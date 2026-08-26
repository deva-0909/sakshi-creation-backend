// Per-module, per-action permission enforcement, built on the existing
// role.permissions structure (a JSON object like
// { "purchase": { view_global, view_own, create, edit, delete }, ... }
// stored on the roles table and embedded into the JWT at login as
// req.user.roleData.permissions — see staff.controller.js's loginStaff).
//
// Until now authenticateToken only confirmed *who* the caller is; nothing
// checked whether their role is actually allowed to perform the action.
// This closes that gap for destructive/high-impact endpoints (delete,
// bulk import, status changes) — the places where getting authorization
// wrong causes real, often irreversible, damage.
//
// Caveat: permissions are baked into the JWT at login time, so a
// permission change doesn't take effect for an already-logged-in staff
// member until they log in again (tokens are valid up to 7 days). That's
// an existing property of this app's auth design, not something this
// patch changes — flagging it here so it isn't mistaken for a bug in
// this middleware.
//
// moduleKey may be a single key ("purchase") or an array of keys to try
// in order ("setup.company-name" then fall back to "setup") for modules
// the role-permissions model doesn't represent individually.
function authorizePermission(moduleKey, action) {
  const keys = Array.isArray(moduleKey) ? moduleKey : [moduleKey];
  return (req, res, next) => {
    const permissions = req.user?.roleData?.permissions;
    if (!permissions || typeof permissions !== "object") {
      return res.status(403).json({
        success: false,
        message: "Access denied: no role permissions found for this account",
      });
    }
    const allowed = keys.some((key) => permissions[key] && permissions[key][action] === true);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: `Access denied: your role does not have '${action}' permission for this module`,
      });
    }
    next();
  };
}

// Multi-role audit fix (Finding 1): authorizePermission() above treats
// "view_global" and "view_own" as two independent boolean actions a caller
// asks for by name -- fine for create/edit/delete/approve, wrong for viewing,
// where they're really two different scopes of the *same* action (view_global
// = see everything, view_own = see only what's mine). Before this, no GET/list
// route called authorizePermission with either flag at all, so a role with
// only view_own (and not view_global) saw the full unscoped list anyway --
// the flag existed in the UI and in the DB but did nothing.
//
// authorizeView(moduleKey, ownershipColumn) closes that gap for list
// endpoints: it 403s unless the role has view_global OR view_own set, and
// when only view_own is set, it attaches `req.viewOwnFilter =
// { column: ownershipColumn, value: req.user.id }` for the controller to
// apply as an extra `.eq(column, value)` on its list query. If view_global
// is set, req.viewOwnFilter is left undefined and the controller returns the
// same full list it always has -- this is additive, not a behavior change
// for any role that already had view_global.
//
// ownershipColumn is the column on the module's table that represents "mine"
// for that module (created_by / assigned_to / requested_by / assign_to --
// varies by table, see the individual route files for which was chosen and
// why). It's optional so this can be wired onto a route ahead of a
// controller being updated to honor req.viewOwnFilter, but every route this
// is actually used on today passes one.
function authorizeView(moduleKey, ownershipColumn) {
  const keys = Array.isArray(moduleKey) ? moduleKey : [moduleKey];
  return (req, res, next) => {
    const permissions = req.user?.roleData?.permissions;
    if (!permissions || typeof permissions !== "object") {
      return res.status(403).json({
        success: false,
        message: "Access denied: no role permissions found for this account",
      });
    }
    const hasGlobal = keys.some((key) => permissions[key] && permissions[key].view_global === true);
    const hasOwn = keys.some((key) => permissions[key] && permissions[key].view_own === true);
    if (!hasGlobal && !hasOwn) {
      return res.status(403).json({
        success: false,
        message: "Access denied: your role does not have view permission for this module",
      });
    }
    if (!hasGlobal && hasOwn && ownershipColumn) {
      req.viewOwnFilter = { column: ownershipColumn, value: req.user?.id };
    }
    next();
  };
}

module.exports = { authorizePermission, authorizeView };
