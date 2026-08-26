const express = require("express");
const PurchaseReturnController = require("../controllers/purchaseReturn.controller");
const { authenticateToken } = require("../middleware/auth");
const { authorizePermission, authorizeView } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createPurchaseReturnSchema } = require("../validators/purchaseReturn.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("purchasereturn", "create"), validate(createPurchaseReturnSchema), PurchaseReturnController.createPurchaseReturn);
router.get("/", authorizeView("purchasereturn", "created_by"), PurchaseReturnController.getAllPurchaseReturns);
router.get("/:id", PurchaseReturnController.getPurchaseReturnById);

module.exports = router;
