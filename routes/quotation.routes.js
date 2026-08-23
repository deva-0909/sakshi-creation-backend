const express = require("express");
const QuotationController = require("../controllers/quotation.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const {
  createQuotationSchema,
  updateQuotationSchema,
  rejectQuotationSchema,
  respondQuotationSchema,
} = require("../validators/quotation.validator");
const router = express.Router();

router.use(authenticateToken);

// New module (Patch 16) -- follows docs/API_CONVENTIONS.md (§55):
// resource-oriented paths, HTTP verb carries the action.
router.post("/", authorizePermission("quotation", "create"), validate(createQuotationSchema), QuotationController.createQuotation);
router.get("/", QuotationController.getAllQuotations);
router.get("/:id", QuotationController.getQuotationById);
router.patch("/:id", authorizePermission("quotation", "edit"), validate(updateQuotationSchema), QuotationController.updateQuotation);
router.delete("/:id", authorizePermission("quotation", "delete"), QuotationController.deleteQuotation);

router.patch("/:id/submit-for-approval", authorizePermission("quotation", "edit"), QuotationController.submitForApproval);
router.patch("/:id/approve", authorizePermission("quotation", "approve"), QuotationController.approveQuotation);
router.patch("/:id/reject", authorizePermission("quotation", "approve"), validate(rejectQuotationSchema), QuotationController.rejectQuotation);
router.patch("/:id/send", authorizePermission("quotation", "edit"), QuotationController.sendQuotation);
router.patch("/:id/respond", authorizePermission("quotation", "edit"), validate(respondQuotationSchema), QuotationController.respondQuotation);
router.post("/:id/convert", authorizePermission("quotation", "create"), QuotationController.convertQuotation);
router.get("/:id/history", QuotationController.getQuotationHistory);
router.get("/:id/pdf", QuotationController.getQuotationPdf);

module.exports = router;
