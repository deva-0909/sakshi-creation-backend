const express = require("express")
const router = express.Router()
const RoleController = require("../controllers/role.controller");

router.post("/create",RoleController.createRole
);
// Get all roles
router.get("/getall", RoleController.getAllRoles);

// Get role by ID
router.get("/getbyid/:id", RoleController.getRoleById);

// Update role by ID
router.put("/updatebyid/:id", RoleController.updateRoleById);

// Delete role by ID
router.delete("/delete/:id", RoleController.deleteRoleById);





module.exports = router;