const express = require('express');
const RoleDepartmentController = require('../controllers/roleDepartment.controller');

const { authenticateToken } = require("../middleware/auth");
const router = express.Router();

router.use(authenticateToken);

router.post("/create", RoleDepartmentController.createRoleDepartment);

router.get("/getall", RoleDepartmentController.getAllRoleDepartments);

router.get("/getbyid/:id", RoleDepartmentController.getRoleDepartmentById);

router.patch("/update/:id", RoleDepartmentController.updateRoleDepartment);

router.delete("/delete/:id", RoleDepartmentController.deleteRoleDepartment);

module.exports = router;