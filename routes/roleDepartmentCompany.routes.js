const express = require('express');
const RoleDepartmentCompanyController = require('../controllers/roleDepartmentCompany.controller');

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createRoleDepartmentCompanySchema, updateRoleDepartmentCompanySchema } = require("../validators/roleDepartmentCompany.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/create", validate(createRoleDepartmentCompanySchema), RoleDepartmentCompanyController.createRoleDepartmentCompany);

router.get("/getall", RoleDepartmentCompanyController.getAllRoleDepartmentCompanies);

router.get("/getbyid/:id", RoleDepartmentCompanyController.getRoleDepartmentCompanyById);

router.patch("/update/:id", validate(updateRoleDepartmentCompanySchema), RoleDepartmentCompanyController.updateRoleDepartmentCompany);

// Same reasoning as roleDepartment.routes.js — no dedicated permission
// key, falls back through setup.role then the generic setup bucket.
router.delete("/delete/:id", authorizePermission(["setup.role", "setup"], "delete"), RoleDepartmentCompanyController.deleteRoleDepartmentCompany);

module.exports = router;