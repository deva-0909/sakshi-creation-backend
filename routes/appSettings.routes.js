const express = require("express");
const AppSettingsController = require("../controllers/appSettings.controller");
const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { updateSettingSchema, updateSettingsBulkSchema } = require("../validators/appSettings.validator");
const router = express.Router();

router.use(authenticateToken);

router.get("/", AppSettingsController.getAllSettings);
router.patch("/bulk", authorizePermission("appsettings", "edit"), validate(updateSettingsBulkSchema), AppSettingsController.updateSettingsBulk);
router.patch("/:key", authorizePermission("appsettings", "edit"), validate(updateSettingSchema), AppSettingsController.updateSetting);

module.exports = router;
