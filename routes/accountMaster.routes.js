const express = require("express");
const AccountMasterController = require("../controllers/accountMaster.controller");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createAccountMasterSchema, updateAccountMasterSchema } = require("../validators/accountMaster.validator");
const router = express.Router();

router.use(authenticateToken);

// Create a new account master
router.post("/create", validate(createAccountMasterSchema), AccountMasterController.createAccountMaster);

// Get all account masters
router.get("/getall", AccountMasterController.getAllAccountMasters);

router.put("/party/:id/approve", AccountMasterController.approveParty);

// Get a single account master by ID
router.get("/getbyid/:id", AccountMasterController.getAccountMasterById);
router.get("/getbystaffid/:id", AccountMasterController.getAccountMasterByStaffId);

// Update an account master by ID
router.patch("/update/:id", validate(updateAccountMasterSchema), AccountMasterController.updateAccountMaster);

// Update account master status
router.patch("/updatestatus/:id", authorizePermission("account_master", "edit"), AccountMasterController.updateAccountMasterStatus);

// Delete an account master by ID
router.delete("/delete/:id", authorizePermission("account_master", "delete"), AccountMasterController.deleteAccountMaster);

// Get all staff for createdBy dropdown
router.get("/staff", AccountMasterController.getAllStaff);

router.post("/bulk-create", authorizePermission("account_master", "create"), upload.single("file"), AccountMasterController.bulkCreateAccountMasters);

// §77: CSV template download for the bulk-import format above.
router.get("/bulk-create/template", AccountMasterController.downloadAccountMasterTemplate);

router.post("/by-company-party", AccountMasterController.getAccountMasterByCompanyAndParty);

router.get("/parties/search", AccountMasterController.searchParties);



module.exports = router;