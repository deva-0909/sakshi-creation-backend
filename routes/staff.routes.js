const express = require("express");
const StaffController = require("../controllers/staff.controller");
const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createStaffSchema, updateStaffSchema } = require("../validators/staff.validator");
const multer = require("multer");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});
// Public: no account exists yet at this point in the flow.
router.post("/login", StaffController.loginStaff);

// Everything else requires a valid session.
// Tier 1 security audit fix (2026-09-01), Fix 2: /create and /update/:id
// had authenticateToken only -- gated to match the "setup.staff" key
// /updatestatus, /delete and /bulk below already use.
router.post("/create", authenticateToken, authorizePermission("setup.staff", "create"), validate(createStaffSchema), StaffController.createStaff);

router.get("/getall", authenticateToken, StaffController.getStaff);

router.get("/getbyid/:id", authenticateToken, StaffController.getStaffById);

router.patch("/update/:id", authenticateToken, authorizePermission("setup.staff", "edit"), validate(updateStaffSchema), StaffController.updateStaff);

router.patch("/updatestatus/:id", authenticateToken, authorizePermission("setup.staff", "edit"), StaffController.updateStaffStatus);

router.delete("/delete/:id", authenticateToken, authorizePermission("setup.staff", "delete"), StaffController.deleteStaff);

router.post("/getrol", authenticateToken, StaffController.getrol);

router.post(
  "/bulk",
  authenticateToken,
  authorizePermission("setup.staff", "create"),
  upload.fields([{ name: "file", maxCount: 1 }]),
  StaffController.bulkCreateStaff
);

// §77: CSV template download for the bulk-import format above.
router.get("/bulk/template", authenticateToken, StaffController.downloadStaffTemplate);

router.patch(
  "/updatepassword/:id",
  authenticateToken,
  StaffController.updateStaffPassword
);
router.get("/permissions/:id", authenticateToken, StaffController.getStaffPermission);
module.exports = router;
