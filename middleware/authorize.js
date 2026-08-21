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

module.exports = { authorizePermission };
