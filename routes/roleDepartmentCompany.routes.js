const express = require('express');
const RoleDepartmentCompanyController = require('../controllers/roleDepartmentCompany.controller');

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createRoleDepartmentCompanySchema, updateRoleDepartmentCompanySchema } = require("../validators/roleDepartmentCompany.validator");
const router = express.Router();

router.use(authenticateToken);

// QA-R9 fix: create/update had no permission gate at all -- any
// authenticated staff member could create or edit department-company
// records regardless of role, the same gap company-name's create/update
// had before patch133. No dedicated "department company" permission key
// exists in the role-permissions model (the frontend's department-company
// page checks none either), so gated the same way delete below already
// is: falls back through setup.role then the generic setup bucket.
router.post("/create", authorizePermission(["setup.role", "setup"], "create"), validate(createRoleDepartmentCompanySchema), RoleDepartmentCompanyController.createRoleDepartmentCompany);

router.get("/getall", RoleDepartmentCompanyController.getAllRoleDepartmentCompanies);

router.get("/getbyid/:id", RoleDepartmentCompanyController.getRoleDepartmentCompanyById);

router.patch("/update/:id", authorizePermission(["setup.role", "setup"], "edit"), validate(updateRoleDepartmentCompanySchema), RoleDepartmentCompanyController.updateRoleDepartmentCompany);

// Same reasoning as roleDepartment.routes.js — no dedicated permission
// key, falls back through setup.role then the generic setup bucket.
router.delete("/delete/:id", authorizePermission(["setup.role", "setup"], "delete"), RoleDepartmentCompanyController.deleteRoleDepartmentCompany);

module.exports = router;