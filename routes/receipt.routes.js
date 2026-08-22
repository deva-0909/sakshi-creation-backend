const express = require("express");
const ReceiptController = require("../controllers/receipt.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createReceiptSchema, createReceiptAllocationSchema } = require("../validators/receipt.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("receipt", "create"), validate(createReceiptSchema), ReceiptController.createReceipt);
router.post("/allocate", authorizePermission("receipt", "create"), validate(createReceiptAllocationSchema), ReceiptController.createReceiptAllocation);
router.get("/", ReceiptController.getAllReceipts);
router.get("/:id", ReceiptController.getReceiptById);

module.exports = router;
