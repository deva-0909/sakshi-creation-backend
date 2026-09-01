const express = require("express");
const PerformanceInvoiceController = require("../controllers/performanceInvoice.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission, authorizeView } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createPerformanceInvoiceSchema, updatePerformanceInvoiceSchema } = require("../validators/performanceInvoice.validator");
const router = express.Router();

router.use(authenticateToken);

// QA-B2 fix: create/getall/getbyid/update had authenticateToken only --
// any logged-in staff member could hit them regardless of role permission,
// while /delete below was already correctly gated on proforma_invoice.
// Gated the same way every other module in this codebase gates its
// create/view/edit endpoints (see routes/invoice.routes.js,
// routes/quotation.routes.js): authorizeView() for the list endpoint so a
// view_own-only role gets req.viewOwnFilter applied by the controller
// instead of the full unscoped list (matches the pattern in
// middleware/authorize.js), authorizePermission() with the matching
// action for the rest. created_by is the ownership column performance_invoices
// actually has (set in createPerformanceInvoice).
router.post("/create", authorizePermission("proforma_invoice", "create"), validate(createPerformanceInvoiceSchema), PerformanceInvoiceController.createPerformanceInvoice);
router.get("/getall", authorizeView("proforma_invoice", "created_by"), PerformanceInvoiceController.getAllPerformanceInvoices);
router.get("/getbyid/:id", authorizePermission("proforma_invoice", "view_global"), PerformanceInvoiceController.getPerformanceInvoiceById);
router.patch("/update/:id", authorizePermission("proforma_invoice", "edit"), validate(updatePerformanceInvoiceSchema), PerformanceInvoiceController.updatePerformanceInvoice);
router.delete("/delete/:id", authorizePermission("proforma_invoice", "delete"), PerformanceInvoiceController.deletePerformanceInvoice);

module.exports = router;