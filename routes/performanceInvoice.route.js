const express = require("express");
const PerformanceInvoiceController = require("../controllers/performanceInvoice.controller");

const router = express.Router();

router.post("/create", PerformanceInvoiceController.createPerformanceInvoice);
router.get("/getall", PerformanceInvoiceController.getAllPerformanceInvoices);
router.get("/getbyid/:id", PerformanceInvoiceController.getPerformanceInvoiceById);
router.patch("/update/:id", PerformanceInvoiceController.updatePerformanceInvoice);
router.delete("/delete/:id", PerformanceInvoiceController.deletePerformanceInvoice);

module.exports = router;