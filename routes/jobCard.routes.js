const express = require("express");
const JobCardController = require("../controllers/jobCard.controller");
const JobCardReworkController = require("../controllers/jobCardRework.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const {
  createJobCardSchema,
  updateJobCardSchema,
  advanceStageSchema,
  materialUsageSchema,
  createReworkSchema,
  rejectReworkSchema,
} = require("../validators/jobCard.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/from-order/:orderId", authorizePermission("jobcard", "create"), validate(createJobCardSchema), JobCardController.createJobCard);
router.get("/wastage-report", JobCardController.getWastageReport);
router.get("/", JobCardController.getAllJobCards);
router.get("/:id", JobCardController.getJobCardById);
router.patch("/:id", authorizePermission("jobcard", "edit"), validate(updateJobCardSchema), JobCardController.updateJobCard);
router.delete("/:id", authorizePermission("jobcard", "delete"), JobCardController.deleteJobCard);

router.patch("/:id/stage", authorizePermission("jobcard", "edit"), validate(advanceStageSchema), JobCardController.advanceStage);
router.get("/:id/stage-history", JobCardController.getStageHistory);
router.post("/:id/material-usage", authorizePermission("jobcard", "edit"), validate(materialUsageSchema), JobCardController.recordMaterialUsage);

// Module 8: Rework -- a structured, approval-gated record, distinct from
// the generic "jobcard" permission since not every jobcard editor should
// necessarily be an approver here (mirrors quotation/purchaseorder's own
// separate "approve" action pattern).
router.post("/:id/reworks", authorizePermission("rework", "create"), validate(createReworkSchema), JobCardReworkController.createRework);
router.get("/:id/reworks", JobCardReworkController.getReworksForJobCard);
router.patch("/:id/reworks/:reworkId/start", authorizePermission("rework", "edit"), JobCardReworkController.startRework);
router.patch("/:id/reworks/:reworkId/submit", authorizePermission("rework", "edit"), JobCardReworkController.submitReworkForApproval);
router.patch("/:id/reworks/:reworkId/approve", authorizePermission("rework", "approve"), JobCardReworkController.approveRework);
router.patch("/:id/reworks/:reworkId/reject", authorizePermission("rework", "approve"), validate(rejectReworkSchema), JobCardReworkController.rejectRework);

module.exports = router;
