const express = require("express");
const PurchaseOrderController = require("../controllers/purchaseOrder.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createPurchaseOrderSchema, updatePurchaseOrderSchema } = require("../validators/purchaseOrder.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("purchaseorder", "create"), validate(createPurchaseOrderSchema), PurchaseOrderController.createPurchaseOrder);
router.post("/from-quote/:quoteId", authorizePermission("purchaseorder", "create"), PurchaseOrderController.selectWinningQuote);
router.get("/", PurchaseOrderController.getAllPurchaseOrders);
router.get("/:id", PurchaseOrderController.getPurchaseOrderById);
router.get("/:id/history", PurchaseOrderController.getPurchaseOrderHistory);
router.patch("/:id", authorizePermission("purchaseorder", "edit"), validate(updatePurchaseOrderSchema), PurchaseOrderController.updatePurchaseOrder);
router.delete("/:id", authorizePermission("purchaseorder", "delete"), PurchaseOrderController.deletePurchaseOrder);
router.patch("/:id/submit-for-approval", authorizePermission("purchaseorder", "edit"), PurchaseOrderController.submitForApproval);
router.patch("/:id/approve", authorizePermission("purchaseorder", "approve"), PurchaseOrderController.approvePurchaseOrder);
router.patch("/:id/reject", authorizePermission("purchaseorder", "approve"), PurchaseOrderController.rejectPurchaseOrder);
router.patch("/:id/send", authorizePermission("purchaseorder", "edit"), PurchaseOrderController.sendPurchaseOrder);
router.patch("/:id/cancel", authorizePermission("purchaseorder", "edit"), PurchaseOrderController.cancelPurchaseOrder);

module.exports = router;
