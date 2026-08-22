const express = require("express");
const ApprovalController = require("../controllers/approval.controller");

const { authenticateToken } = require("../middleware/auth");
const router = express.Router();

router.use(authenticateToken);

// No authorizePermission gate on the route itself -- the controller scopes
// results per-caller by reading req.user.roleData.permissions directly
// (a staff member with neither quotation.approve nor purchaseorder.approve
// simply gets an empty list back, same as "nothing pending for you").
router.get("/pending", ApprovalController.getMyPendingApprovals);

module.exports = router;
