const express = require("express");
const CostingController = require("../controllers/costing.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { upsertLaborCostSchema } = require("../validators/costing.validator");
const router = express.Router();

router.use(authenticateToken);

router.get("/", CostingController.getAllCosting);
router.get("/:jobCardId", CostingController.getCostingByJobCard);
router.put("/:jobCardId/labor", authorizePermission("costing", "edit"), validate(upsertLaborCostSchema), CostingController.upsertLaborCost);

module.exports = router;
