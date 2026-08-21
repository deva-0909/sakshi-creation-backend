const express = require("express");
const LeadController = require("../controllers/lead.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createLeadSchema, updateLeadSchema } = require("../validators/lead.validator");
const router = express.Router();

router.use(authenticateToken);

// Create a new lead
router.post("/create", validate(createLeadSchema), LeadController.createLead);

// Get all leads
router.get("/getall", LeadController.getAllLeads);

// Get lead by ID
router.get("/getbyid/:id", LeadController.getLeadById);
router.get("/getbystaffid/:id", LeadController.getLeadsByStaffId);
router.post("/create/bulk", authorizePermission("party_call", "create"), LeadController.bulkCreateLeads);

// §77: CSV template download for the bulk-import field names above.
router.get("/create/bulk/template", LeadController.downloadLeadTemplate);

// Update lead
router.patch("/update/:id", validate(updateLeadSchema), LeadController.updateLeadById);

// Update lead status
router.patch("/updatestatus/:id", authorizePermission("party_call", "edit"), LeadController.updateLeadStatus);

// Delete lead
router.delete("/delete/:id", authorizePermission("party_call", "delete"), LeadController.deleteLead);

// Get party names by company
router.get("/party-names", LeadController.getPartyNamesByCompany);

module.exports = router;