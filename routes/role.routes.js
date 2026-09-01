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
router.get("/getall", RoleController.getAllRoles);

// Get role by ID
router.get("/getbyid/:id", RoleController.getRoleById);

// Update role by ID
router.put("/updatebyid/:id", authorizePermission("setup.role", "edit"), validate(updateRoleSchema), RoleController.updateRoleById);

// Delete role by ID
router.delete("/delete/:id", authorizePermission("setup.role", "delete"), RoleController.deleteRoleById);





module.exports = router;