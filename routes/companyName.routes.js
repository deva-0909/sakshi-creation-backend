const express = require("express");
const CompanyNameController = require("../controllers/companyName.controller");

const router = express.Router();

// Create a new company name
router.post("/create", CompanyNameController.createCompanyName);

// Get all company names
router.get("/getall", CompanyNameController.getCompanyNames);

router.get("/getallCompany", CompanyNameController.getAllCompanyNames);

// Get a single company name by ID
router.get("/getbyid/:id", CompanyNameController.getCompanyNameById);

router.get("/get-party-with-company-id/:id", CompanyNameController.getPartywithCompany);


// Update a company name by ID
router.patch("/update/:id", CompanyNameController.updateCompanyName);

// Delete a company name by ID
router.delete("/delete/:id", CompanyNameController.deleteCompanyName);

module.exports = router;