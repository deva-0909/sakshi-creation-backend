const express = require('express');
const VendorController = require('../controllers/vendor.controller');
const multer = require('multer');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/create", VendorController.createVendor);

router.get("/getall", VendorController.getVendors);

router.get("/getbyid/:id", VendorController.getVendorById);

router.patch("/update/:id", VendorController.updateVendor);

router.delete("/delete/:id", VendorController.deleteVendor);

router.post('/bulk', upload.single('file'), VendorController.bulkCreateVendors);

module.exports = router;