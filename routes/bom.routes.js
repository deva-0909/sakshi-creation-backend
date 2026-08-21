const express = require("express");
const BomController = require("../controllers/bom.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createBomSchema, updateBomSchema } = require("../validators/bom.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("bom", "create"), validate(createBomSchema), BomController.createBomLine);
router.get("/product/:productItemId", BomController.getBomForProduct);
router.patch("/:id", authorizePermission("bom", "edit"), validate(updateBomSchema), BomController.updateBomLine);
router.delete("/:id", authorizePermission("bom", "delete"), BomController.deleteBomLine);
router.get("/product/:productItemId/estimate-cost", BomController.estimateCost);

module.exports = router;
