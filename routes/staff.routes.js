const express = require("express");
const StaffController = require("../controllers/staff.controller");
const { authenticateToken } = require("../middleware/auth");
const multer = require("multer");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});
router.post("/create", StaffController.createStaff);

router.get("/getall", StaffController.getStaff);

router.get("/getbyid/:id", StaffController.getStaffById);

router.patch("/update/:id", StaffController.updateStaff);

router.patch("/updatestatus/:id", StaffController.updateStaffStatus);

router.delete("/delete/:id", StaffController.deleteStaff);

router.post("/login", StaffController.loginStaff);

router.post("/getrol", StaffController.getrol);

router.post(
  "/bulk",
  upload.fields([{ name: "file", maxCount: 1 }]),
  StaffController.bulkCreateStaff
);
router.patch(
  "/updatepassword/:id",
  authenticateToken,
  StaffController.updateStaffPassword
);
router.get("/permissions/:id", StaffController.getStaffPermission);
module.exports = router;
