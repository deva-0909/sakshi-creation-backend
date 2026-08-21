const express = require("express");
const PerformanceInvoiceController = require("../controllers/performanceInvoice.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const router = express.Router();

router.use(authenticateToken);

router.post("/create", PerformanceInvoiceController.createPerformanceInvoice);
router.get("/getall", PerformanceInvoiceController.getAllPerformanceInvoices);
router.get("/getbyid/:id", PerformanceInvoiceController.getPerformanceInvoiceById);
router.patch("/update/:id", PerformanceInvoiceController.updatePerformanceInvoice);
router.delete("/delete/:id", authorizePermission("proforma_invoice", "delete"), PerformanceInvoiceController.deletePerformanceInvoice);

module.exports = router;