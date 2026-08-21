const express = require("express")
const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createRoleSchema, updateRoleSchema } = require("../validators/role.validator");
const router = express.Router()

router.use(authenticateToken);
const RoleController = require("../controllers/role.controller");

router.post("/create", validate(createRoleSchema), RoleController.createRole
);
// Get all roles
router.get("/getall", RoleController.getAllRoles);

// Get role by ID
router.get("/getbyid/:id", RoleController.getRoleById);

// Update role by ID
router.put("/updatebyid/:id", validate(updateRoleSchema), RoleController.updateRoleById);

// Delete role by ID
router.delete("/delete/:id", authorizePermission("setup.role", "delete"), RoleController.deleteRoleById);





module.exports = router;