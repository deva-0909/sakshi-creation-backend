const express = require("express");
const UomController = require("../controllers/uom.controller");
const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createUomSchema, updateUomSchema } = require("../validators/uom.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("uom", "create"), validate(createUomSchema), UomController.createUom);
router.get("/", UomController.getAllUoms);
router.patch("/:id", authorizePermission("uom", "edit"), validate(updateUomSchema), UomController.updateUom);
router.delete("/:id", authorizePermission("uom", "delete"), UomController.deleteUom);

module.exports = router;
