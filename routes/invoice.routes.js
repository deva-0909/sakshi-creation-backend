const express = require("express");
const InvoiceController = require("../controllers/invoice.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission, authorizeView } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createInvoiceSchema } = require("../validators/invoice.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("invoice", "create"), validate(createInvoiceSchema), InvoiceController.createInvoice);
router.get("/", authorizeView("invoice", "created_by"), InvoiceController.getAllInvoices);
// Patch 131 (invoice/delivery linkage): must come before "/:id" so
// "remaining-quantity" isn't captured as an invoice id.
router.get("/remaining-quantity/:orderId", InvoiceController.getRemainingQuantityForOrder);
router.get("/:id", InvoiceController.getInvoiceById);
router.get("/:id/history", InvoiceController.getInvoiceHistory);
router.get("/:id/pdf", InvoiceController.getInvoicePdf);
router.delete("/:id", authorizePermission("invoice", "delete"), InvoiceController.deleteInvoice);
router.patch("/:id/issue", authorizePermission("invoice", "edit"), InvoiceController.issueInvoice);
router.patch("/:id/cancel", authorizePermission("invoice", "edit"), InvoiceController.cancelInvoice);

module.exports = router;
