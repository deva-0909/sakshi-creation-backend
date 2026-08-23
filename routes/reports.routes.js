const express = require("express");
const ReportsController = require("../controllers/reports.controller");
const { authenticateToken } = require("../middleware/auth");
const router = express.Router();

router.use(authenticateToken);

// Module 14: Reporting Depth. Read-only rollups, gated only on
// authentication like every other report/dashboard GET in this app
// (getAllOrders, getAllOpportunities, dashboard.routes.js, etc. carry no
// per-permission gate on their list endpoints either).
router.get("/delayed-jobs", ReportsController.getDelayedJobs);
router.get("/customer-performance", ReportsController.getCustomerPerformance);
router.get("/salesperson-performance", ReportsController.getSalespersonPerformance);
router.get("/purchase-rate-trend", ReportsController.getPurchaseRateTrend);

module.exports = router;
