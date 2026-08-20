const express = require("express");
const LeadController = require("../controllers/lead.controller");

const router = express.Router();

// Create a new lead
router.post("/create", LeadController.createLead);

// Get all leads
router.get("/getall", LeadController.getAllLeads);

// Get lead by ID
router.get("/getbyid/:id", LeadController.getLeadById);
router.get("/getbystaffid/:id", LeadController.getLeadsByStaffId);
router.post("/create/bulk", LeadController.bulkCreateLeads);
// Update lead
router.patch("/update/:id", LeadController.updateLeadById);

// Update lead status
router.patch("/updatestatus/:id", LeadController.updateLeadStatus);

// Delete lead
router.delete("/delete/:id", LeadController.deleteLead);

// Get party names by company
router.get("/party-names", LeadController.getPartyNamesByCompany);

module.exports = router;