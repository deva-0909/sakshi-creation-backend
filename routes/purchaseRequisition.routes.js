const express = require("express");
const PurchaseRequisitionController = require("../controllers/purchaseRequisition.controller");
const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const {
  createPurchaseRequisitionSchema,
  rejectPurchaseRequisitionSchema,
  cancelPurchaseRequisitionSchema,
  convertToRfqSchema,
  convertToPoSchema,
} = require("../validators/purchaseRequisition.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("purchaserequisition", "create"), validate(createPurchaseRequisitionSchema), PurchaseRequisitionController.createPurchaseRequisition);
router.get("/", PurchaseRequisitionController.getAllPurchaseRequisitions);
router.get("/:id", PurchaseRequisitionController.getPurchaseRequisitionById);
router.get("/:id/history", PurchaseRequisitionController.getPurchaseRequisitionHistory);
router.delete("/:id", authorizePermission("purchaserequisition", "delete"), PurchaseRequisitionController.deletePurchaseRequisition);

router.patch("/:id/submit-for-approval", authorizePermission("purchaserequisition", "edit"), PurchaseRequisitionController.submitForApproval);
router.patch("/:id/approve", authorizePermission("purchaserequisition", "approve"), PurchaseRequisitionController.approvePurchaseRequisition);
router.patch("/:id/reject", authorizePermission("purchaserequisition", "approve"), validate(rejectPurchaseRequisitionSchema), PurchaseRequisitionController.rejectPurchaseRequisition);
router.patch("/:id/cancel", authorizePermission("purchaserequisition", "edit"), validate(cancelPurchaseRequisitionSchema), PurchaseRequisitionController.cancelPurchaseRequisition);

router.post("/:id/convert-to-rfq", authorizePermission("purchaserequisition", "edit"), validate(convertToRfqSchema), PurchaseRequisitionController.convertToRfq);
router.post("/:id/convert-to-po", authorizePermission("purchaserequisition", "edit"), validate(convertToPoSchema), PurchaseRequisitionController.convertToPo);

module.exports = router;
