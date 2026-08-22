const express = require("express");
const NumberingConfigController = require("../controllers/numberingConfig.controller");
const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { updateNumberingConfigSchema } = require("../validators/numberingConfig.validator");
const router = express.Router();

router.use(authenticateToken);

router.get("/", NumberingConfigController.getAllNumberingConfigs);
router.patch("/:id", authorizePermission("numberingconfig", "edit"), validate(updateNumberingConfigSchema), NumberingConfigController.updateNumberingConfig);

module.exports = router;
