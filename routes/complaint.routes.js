const express = require("express");
const ComplaintController = require("../controllers/complaint.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createComplaintSchema, updateComplaintSchema } = require("../validators/complaint.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("complaint", "create"), validate(createComplaintSchema), ComplaintController.createComplaint);
router.get("/", ComplaintController.getAllComplaints);
router.get("/:id", ComplaintController.getComplaintById);
router.patch("/:id", authorizePermission("complaint", "edit"), validate(updateComplaintSchema), ComplaintController.updateComplaint);
router.delete("/:id", authorizePermission("complaint", "delete"), ComplaintController.deleteComplaint);

module.exports = router;
