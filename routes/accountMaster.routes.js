const express = require("express");
const AccountMasterController = require("../controllers/accountMaster.controller");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

// Create a new account master
router.post("/create", AccountMasterController.createAccountMaster);

// Get all account masters
router.get("/getall", AccountMasterController.getAllAccountMasters);

router.put("/party/:id/approve", AccountMasterController.approveParty);

// Get a single account master by ID
router.get("/getbyid/:id", AccountMasterController.getAccountMasterById);
router.get("/getbystaffid/:id", AccountMasterController.getAccountMasterByStaffId);

// Update an account master by ID
router.patch("/update/:id", AccountMasterController.updateAccountMaster);

// Update account master status
router.patch("/updatestatus/:id", AccountMasterController.updateAccountMasterStatus);

// Delete an account master by ID
router.delete("/delete/:id", AccountMasterController.deleteAccountMaster);

// Get all staff for createdBy dropdown
router.get("/staff", AccountMasterController.getAllStaff);

router.post("/bulk-create", upload.single("file"), AccountMasterController.bulkCreateAccountMasters);

router.post("/by-company-party", AccountMasterController.getAccountMasterByCompanyAndParty);

router.get("/parties/search", AccountMasterController.searchParties);



module.exports = router;