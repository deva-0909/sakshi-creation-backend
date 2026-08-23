const express = require("express");
const StockMovementController = require("../controllers/stockMovement.controller");
const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const {
  createStockTransferSchema,
  createStockAdjustmentSchema,
  createStockReservationSchema,
  updateStockReservationStatusSchema,
} = require("../validators/stockMovement.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/transfers", authorizePermission("stocktransfer", "create"), validate(createStockTransferSchema), StockMovementController.createStockTransfer);
router.get("/transfers", StockMovementController.getAllStockTransfers);

router.post("/adjustments", authorizePermission("stockadjustment", "create"), validate(createStockAdjustmentSchema), StockMovementController.createStockAdjustment);
router.get("/adjustments", StockMovementController.getAllStockAdjustments);

router.post("/reservations", authorizePermission("stockreservation", "create"), validate(createStockReservationSchema), StockMovementController.createStockReservation);
router.get("/reservations", StockMovementController.getAllStockReservations);
router.patch(
  "/reservations/:id/status",
  authorizePermission("stockreservation", "edit"),
  validate(updateStockReservationStatusSchema),
  StockMovementController.updateStockReservationStatus
);
router.delete("/reservations/:id", authorizePermission("stockreservation", "delete"), StockMovementController.deleteStockReservation);

module.exports = router;
