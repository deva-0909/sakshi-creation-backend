const express = require("express");
const LeadController = require("../controllers/lead.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const router = express.Router();

router.use(authenticateToken);

// Create a new lead
router.post("/create", LeadController.createLead);

// Get all leads
router.get("/getall", LeadController.getAllLeads);

// Get lead by ID
router.get("/getbyid/:id", LeadController.getLeadById);
router.get("/getbystaffid/:id", LeadController.getLeadsByStaffId);
router.post("/create/bulk", authorizePermission("party_call", "create"), LeadController.bulkCreateLeads);
// Update lead
router.patch("/update/:id", LeadController.updateLeadById);

// Update lead status
router.patch("/updatestatus/:id", authorizePermission("party_call", "edit"), LeadController.updateLeadStatus);

// Delete lead
router.delete("/delete/:id", authorizePermission("party_call", "delete"), LeadController.deleteLead);

// Get party names by company
router.get("/party-names", LeadController.getPartyNamesByCompany);

module.exports = router;