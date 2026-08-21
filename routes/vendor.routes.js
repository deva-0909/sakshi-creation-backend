const express = require('express');
const VendorController = require('../controllers/vendor.controller');
const multer = require('multer');

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createVendorSchema, updateVendorSchema } = require("../validators/vendor.validator");
const router = express.Router();

router.use(authenticateToken);
const upload = multer({ storage: multer.memoryStorage() });

router.post("/create", validate(createVendorSchema), VendorController.createVendor);

router.get("/getall", VendorController.getVendors);

router.get("/getbyid/:id", VendorController.getVendorById);

router.patch("/update/:id", validate(updateVendorSchema), VendorController.updateVendor);

// No dedicated "vendor" permission key exists in the role-permissions
// model — falls back to the generic setup bucket.
router.delete("/delete/:id", authorizePermission("setup", "delete"), VendorController.deleteVendor);

router.post('/bulk', authorizePermission("setup", "create"), upload.single('file'), VendorController.bulkCreateVendors);

// §77: CSV template download for the bulk-import format above.
router.get('/bulk/template', VendorController.downloadVendorTemplate);

module.exports = router;