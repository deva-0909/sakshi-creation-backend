const express = require("express")
const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createRoleSchema, updateRoleSchema } = require("../validators/role.validator");
const router = express.Router()

router.use(authenticateToken);
const RoleController = require("../controllers/role.controller");

// Tier 1 security audit fix (2026-09-01), Fix 2: /create and
// /updatebyid/:id had authenticateToken only -- gated to match the
// "setup.role" key /delete below already uses.
router.post("/create", authorizePermission("setup.role", "create"), validate(createRoleSchema), RoleController.createRole
);
// Get all roles
// Tier 1 security audit fix (2026-09-01), Fix 3: this returned the full
// role roster -- including every role's complete permissions JSON -- to
// any authenticated staff member, e.g. a client-facing Viewer. Gated on
// setup.role view_global, same convention loginHistory.routes.js already
// uses for setup.staff. Dropdown call sites that don't hold setup.role
// were moved to /list-lite below instead of being broken by this.
router.get("/getall", authorizePermission("setup.role", "view_global"), RoleController.getAllRoles);

// Lightweight id+roleName listing for picker/dropdown use -- see the
// getAllRolesLite controller comment. Deliberately NOT permission-gated
// beyond authenticateToken: it carries no permissions payload, so there's
// nothing sensitive to protect here.
router.get("/list-lite", RoleController.getAllRolesLite);

// Get role by ID
router.get("/getbyid/:id", RoleController.getRoleById);

// Update role by ID
router.put("/updatebyid/:id", authorizePermission("setup.role", "edit"), validate(updateRoleSchema), RoleController.updateRoleById);

// Delete role by ID
router.delete("/delete/:id", authorizePermission("setup.role", "delete"), RoleController.deleteRoleById);





module.exports = router;