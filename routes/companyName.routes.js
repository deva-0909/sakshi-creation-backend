const express = require("express");
const CompanyNameController = require("../controllers/companyName.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createCompanyNameSchema, updateCompanyNameSchema } = require("../validators/companyName.validator");
const router = express.Router();

router.use(authenticateToken);

// Create a new company name
router.post("/create", authorizePermission("setup.company-name", "create"), validate(createCompanyNameSchema), CompanyNameController.createCompanyName);

// Get all company names
router.get("/getall", CompanyNameController.getCompanyNames);

router.get("/getallCompany", CompanyNameController.getAllCompanyNames);

// Get a single company name by ID
router.get("/getbyid/:id", CompanyNameController.getCompanyNameById);

router.get("/get-party-with-company-id/:id", CompanyNameController.getPartywithCompany);


// Update a company name by ID
router.patch("/update/:id", authorizePermission("setup.company-name", "edit"), validate(updateCompanyNameSchema), CompanyNameController.updateCompanyName);

// Delete a company name by ID
router.delete("/delete/:id", authorizePermission("setup.company-name", "delete"), CompanyNameController.deleteCompanyName);

module.exports = router;