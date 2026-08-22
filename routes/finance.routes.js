// Read-only report routes over computed receivables/payables data -- same
// pattern as stockLedger.routes.js: authenticateToken only, no
// authorizePermission, since these are report views rather than
// state-changing actions and don't warrant a dedicated permission key.
const express = require("express");
const FinanceController = require("../controllers/finance.controller");

const { authenticateToken } = require("../middleware/auth");
const router = express.Router();

router.use(authenticateToken);

router.get("/customer-ledger/:partyId", FinanceController.getCustomerLedger);
router.get("/customer-ageing", FinanceController.getCustomerAgeing);
router.get("/vendor-ledger/:vendorId", FinanceController.getVendorLedger);
router.get("/vendor-ageing", FinanceController.getVendorAgeing);

module.exports = router;
