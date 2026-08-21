const express = require("express");
const StaffController = require("../controllers/staff.controller");
const { authenticateToken } = require("../middleware/auth");
const multer = require("multer");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});
// Public: no account exists yet at this point in the flow.
router.post("/login", StaffController.loginStaff);

// Everything else requires a valid session.
router.post("/create", authenticateToken, StaffController.createStaff);

router.get("/getall", authenticateToken, StaffController.getStaff);

router.get("/getbyid/:id", authenticateToken, StaffController.getStaffById);

router.patch("/update/:id", authenticateToken, StaffController.updateStaff);

router.patch("/updatestatus/:id", authenticateToken, StaffController.updateStaffStatus);

router.delete("/delete/:id", authenticateToken, StaffController.deleteStaff);

router.post("/getrol", authenticateToken, StaffController.getrol);

router.post(
  "/bulk",
  authenticateToken,
  upload.fields([{ name: "file", maxCount: 1 }]),
  StaffController.bulkCreateStaff
);
router.patch(
  "/updatepassword/:id",
  authenticateToken,
  StaffController.updateStaffPassword
);
router.get("/permissions/:id", authenticateToken, StaffController.getStaffPermission);
module.exports = router;
