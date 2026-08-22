const express = require("express");
const StaffController = require("../controllers/staff.controller");
const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const router = express.Router();

router.use(authenticateToken);

router.get("/", authorizePermission("setup.staff", "view_global"), StaffController.getLoginHistory);

module.exports = router;
