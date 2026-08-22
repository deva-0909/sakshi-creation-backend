const express = require("express");
const VendorPaymentController = require("../controllers/vendorPayment.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createVendorPaymentSchema } = require("../validators/vendorPayment.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("vendorpayment", "create"), validate(createVendorPaymentSchema), VendorPaymentController.createVendorPayment);
router.get("/", VendorPaymentController.getAllVendorPayments);
router.get("/:id", VendorPaymentController.getVendorPaymentById);

module.exports = router;
