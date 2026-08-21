const express = require("express");
const JobCardController = require("../controllers/jobCard.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const {
  createJobCardSchema,
  updateJobCardSchema,
  advanceStageSchema,
  materialUsageSchema,
} = require("../validators/jobCard.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/from-order/:orderId", authorizePermission("jobcard", "create"), validate(createJobCardSchema), JobCardController.createJobCard);
router.get("/", JobCardController.getAllJobCards);
router.get("/:id", JobCardController.getJobCardById);
router.patch("/:id", authorizePermission("jobcard", "edit"), validate(updateJobCardSchema), JobCardController.updateJobCard);
router.delete("/:id", authorizePermission("jobcard", "delete"), JobCardController.deleteJobCard);

router.patch("/:id/stage", authorizePermission("jobcard", "edit"), validate(advanceStageSchema), JobCardController.advanceStage);
router.get("/:id/stage-history", JobCardController.getStageHistory);
router.post("/:id/material-usage", authorizePermission("jobcard", "edit"), validate(materialUsageSchema), JobCardController.recordMaterialUsage);

module.exports = router;
