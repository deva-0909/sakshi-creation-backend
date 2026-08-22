const express = require("express");
const TaxRateController = require("../controllers/taxRate.controller");
const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createTaxRateSchema, updateTaxRateSchema } = require("../validators/taxRate.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("taxrate", "create"), validate(createTaxRateSchema), TaxRateController.createTaxRate);
router.get("/", TaxRateController.getAllTaxRates);
router.patch("/:id", authorizePermission("taxrate", "edit"), validate(updateTaxRateSchema), TaxRateController.updateTaxRate);
router.delete("/:id", authorizePermission("taxrate", "delete"), TaxRateController.deleteTaxRate);

module.exports = router;
