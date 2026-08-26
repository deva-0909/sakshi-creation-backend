const express = require("express");
const GodownBoxReceiptController = require("../controllers/godownBoxReceipt.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createGodownBoxReceiptSchema, updateGodownBoxReceiptSchema } = require("../validators/godownBoxReceipt.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("godown_box_receipt", "create"), validate(createGodownBoxReceiptSchema), GodownBoxReceiptController.createGodownBoxReceipt);
router.get("/", GodownBoxReceiptController.getAllGodownBoxReceipts);
router.get("/:id", GodownBoxReceiptController.getGodownBoxReceiptById);
router.patch("/:id", authorizePermission("godown_box_receipt", "edit"), validate(updateGodownBoxReceiptSchema), GodownBoxReceiptController.updateGodownBoxReceipt);
router.delete("/:id", authorizePermission("godown_box_receipt", "delete"), GodownBoxReceiptController.deleteGodownBoxReceipt);

module.exports = router;
