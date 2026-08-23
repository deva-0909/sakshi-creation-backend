const express = require("express");
const WarehouseController = require("../controllers/warehouse.controller");
const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createWarehouseSchema, updateWarehouseSchema } = require("../validators/warehouse.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("warehouse", "create"), validate(createWarehouseSchema), WarehouseController.createWarehouse);
router.get("/", WarehouseController.getAllWarehouses);
router.get("/:id", WarehouseController.getWarehouseById);
router.patch("/:id", authorizePermission("warehouse", "edit"), validate(updateWarehouseSchema), WarehouseController.updateWarehouse);
router.delete("/:id", authorizePermission("warehouse", "delete"), WarehouseController.deleteWarehouse);

module.exports = router;
