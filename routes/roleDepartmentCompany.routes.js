const express = require('express');
const RoleDepartmentCompanyController = require('../controllers/roleDepartmentCompany.controller');

const { authenticateToken } = require("../middleware/auth");
const router = express.Router();

router.use(authenticateToken);

router.post("/create", RoleDepartmentCompanyController.createRoleDepartmentCompany);

router.get("/getall", RoleDepartmentCompanyController.getAllRoleDepartmentCompanies);

router.get("/getbyid/:id", RoleDepartmentCompanyController.getRoleDepartmentCompanyById);

router.patch("/update/:id", RoleDepartmentCompanyController.updateRoleDepartmentCompany);

router.delete("/delete/:id", RoleDepartmentCompanyController.deleteRoleDepartmentCompany);

module.exports = router;