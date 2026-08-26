const express = require("express");
const RfqController = require("../controllers/rfq.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission, authorizeView } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createRfqSchema, recordVendorQuoteSchema } = require("../validators/rfq.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("rfq", "create"), validate(createRfqSchema), RfqController.createRfq);
router.get("/", authorizeView("rfq", "created_by"), RfqController.getAllRfqs);
router.get("/:id", RfqController.getRfqById);
router.delete("/:id", authorizePermission("rfq", "delete"), RfqController.deleteRfq);
router.patch("/:id/send", authorizePermission("rfq", "edit"), RfqController.sendRfq);
router.patch("/:id/cancel", authorizePermission("rfq", "edit"), RfqController.cancelRfq);
router.patch("/quotes/:quoteId", authorizePermission("rfq", "edit"), validate(recordVendorQuoteSchema), RfqController.recordVendorQuote);

module.exports = router;
