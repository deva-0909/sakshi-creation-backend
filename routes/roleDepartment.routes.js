const express = require('express');
const RoleDepartmentController = require('../controllers/roleDepartment.controller');

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const router = express.Router();

router.use(authenticateToken);

router.post("/create", RoleDepartmentController.createRoleDepartment);

router.get("/getall", RoleDepartmentController.getAllRoleDepartments);

router.get("/getbyid/:id", RoleDepartmentController.getRoleDepartmentById);

router.patch("/update/:id", RoleDepartmentController.updateRoleDepartment);

// No dedicated "role department" key exists in the role-permissions
// model — this falls under role/setup management, so it checks
// setup.role first and falls back to the generic setup bucket.
router.delete("/delete/:id", authorizePermission(["setup.role", "setup"], "delete"), RoleDepartmentController.deleteRoleDepartment);

module.exports = router;