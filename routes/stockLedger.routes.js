const express = require("express");
const StockLedgerController = require("../controllers/stockLedger.controller");

const { authenticateToken } = require("../middleware/auth");
const router = express.Router();

router.use(authenticateToken);

// Read-only, reuses the existing `inventory` permission key rather than
// introducing a new one -- this is a different view over the same data
// getInventorySummary already exposes without a permission gate of its own.
router.get("/material/:materialId", StockLedgerController.getMaterialLedger);
router.get("/summary", StockLedgerController.getSummary);
router.get("/availability/:materialId", StockLedgerController.getAvailability);

module.exports = router;
