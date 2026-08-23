const express = require("express");
const OpportunityController = require("../controllers/opportunity.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createOpportunitySchema, updateOpportunitySchema, loseOpportunitySchema, addActivitySchema, convertToQuotationSchema } = require("../validators/opportunity.validator");
const router = express.Router();

router.use(authenticateToken);

// Follows docs/API_CONVENTIONS.md (§55): resource-oriented paths, HTTP
// verb carries the action -- same shape as Quotation/Purchase Order.
router.post("/", authorizePermission("opportunity", "create"), validate(createOpportunitySchema), OpportunityController.createOpportunity);
router.get("/", OpportunityController.getAllOpportunities);
router.get("/:id", OpportunityController.getOpportunityById);
router.patch("/:id", authorizePermission("opportunity", "edit"), validate(updateOpportunitySchema), OpportunityController.updateOpportunity);
router.delete("/:id", authorizePermission("opportunity", "delete"), OpportunityController.deleteOpportunity);

router.patch("/:id/contact", authorizePermission("opportunity", "edit"), OpportunityController.markContacted);
router.patch("/:id/qualify", authorizePermission("opportunity", "edit"), OpportunityController.markQualified);
router.patch("/:id/gather-requirements", authorizePermission("opportunity", "edit"), OpportunityController.markRequirementGathering);
router.patch("/:id/send-proposal", authorizePermission("opportunity", "edit"), OpportunityController.markProposalSent);
router.patch("/:id/negotiate", authorizePermission("opportunity", "edit"), OpportunityController.markNegotiation);
router.patch("/:id/win", authorizePermission("opportunity", "edit"), OpportunityController.markWon);
router.patch("/:id/lose", authorizePermission("opportunity", "edit"), validate(loseOpportunitySchema), OpportunityController.markLost);

// Module 15: Opportunity -> Quotation conversion, gated to Won opportunities only.
router.post(
  "/:id/convert-to-quotation",
  authorizePermission("opportunity", "edit"),
  validate(convertToQuotationSchema),
  OpportunityController.convertOpportunityToQuotation
);

router.get("/:id/history", OpportunityController.getOpportunityHistory);
router.get("/:id/activities", OpportunityController.getOpportunityActivities);
router.post("/:id/activities", authorizePermission("opportunity", "edit"), validate(addActivitySchema), OpportunityController.addOpportunityActivity);

module.exports = router;
