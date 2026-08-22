const express = require("express");
const VendorPaymentController = require("../controllers/vendorPayment.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createVendorPaymentSchema, createVendorPaymentAllocationSchema } = require("../validators/vendorPayment.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("vendorpayment", "create"), validate(createVendorPaymentSchema), VendorPaymentController.createVendorPayment);
router.post(
  "/allocate",
  authorizePermission("vendorpayment", "create"),
  validate(createVendorPaymentAllocationSchema),
  VendorPaymentController.createVendorPaymentAllocation
);
router.get("/", VendorPaymentController.getAllVendorPayments);
router.get("/:id", VendorPaymentController.getVendorPaymentById);

module.exports = router;
