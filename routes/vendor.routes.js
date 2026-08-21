const express = require('express');
const VendorController = require('../controllers/vendor.controller');
const multer = require('multer');

const { authenticateToken } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { createVendorSchema, updateVendorSchema } = require("../validators/vendor.validator");
const router = express.Router();

router.use(authenticateToken);
const upload = multer({ storage: multer.memoryStorage() });

router.post("/create", validate(createVendorSchema), VendorController.createVendor);

router.get("/getall", VendorController.getVendors);

router.get("/getbyid/:id", VendorController.getVendorById);

router.patch("/update/:id", validate(updateVendorSchema), VendorController.updateVendor);

router.delete("/delete/:id", VendorController.deleteVendor);

router.post('/bulk', upload.single('file'), VendorController.bulkCreateVendors);

module.exports = router;