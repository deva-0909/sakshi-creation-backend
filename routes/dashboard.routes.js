const express = require("express");
const DashboardController = require("../controllers/dashboard.controller");

const { authenticateToken } = require("../middleware/auth");
const router = express.Router();

router.use(authenticateToken);

// No authorizePermission gate -- per the Module 6 design decision every
// logged-in staff member can load the dashboard; the controller itself
// scopes each individual widget to the caller's existing per-module view
// permissions (see dashboard.controller.js's hasView()).
router.get("/summary", DashboardController.getDashboardSummary);

module.exports = router;
