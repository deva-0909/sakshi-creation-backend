const express = require("express");
const InvoiceController = require("../controllers/invoice.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createInvoiceSchema } = require("../validators/invoice.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("invoice", "create"), validate(createInvoiceSchema), InvoiceController.createInvoice);
router.get("/", InvoiceController.getAllInvoices);
router.get("/:id", InvoiceController.getInvoiceById);
router.get("/:id/history", InvoiceController.getInvoiceHistory);
router.delete("/:id", authorizePermission("invoice", "delete"), InvoiceController.deleteInvoice);
router.patch("/:id/issue", authorizePermission("invoice", "edit"), InvoiceController.issueInvoice);
router.patch("/:id/cancel", authorizePermission("invoice", "edit"), InvoiceController.cancelInvoice);

module.exports = router;
