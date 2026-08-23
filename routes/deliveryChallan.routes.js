const express = require("express");
const DeliveryChallanController = require("../controllers/deliveryChallan.controller");
const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const {
  createDeliveryChallanSchema,
  recordPodSchema,
  cancelDeliveryChallanSchema,
} = require("../validators/deliveryChallan.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("deliverychallan", "create"), validate(createDeliveryChallanSchema), DeliveryChallanController.createDeliveryChallan);
router.get("/", DeliveryChallanController.getAllDeliveryChallans);
router.get("/:id", DeliveryChallanController.getDeliveryChallanById);
router.patch("/:id/pod", authorizePermission("deliverychallan", "edit"), validate(recordPodSchema), DeliveryChallanController.recordProofOfDelivery);
router.patch("/:id/cancel", authorizePermission("deliverychallan", "edit"), validate(cancelDeliveryChallanSchema), DeliveryChallanController.cancelDeliveryChallan);
router.get("/:id/pdf", DeliveryChallanController.getDeliveryChallanPdf);

module.exports = router;
