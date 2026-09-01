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

// Functional audit Fix 4: create/update had no authorizePermission gate at
// all -- confirmed via a live query across every role's permissions JSONB
// that no "vendor" key existed anywhere in the schema, so these two write
// routes were reachable by any authenticated staff member regardless of
// role. Gated on a new "vendor" key, tried first, falling back to the
// existing generic "setup" bucket the delete/bulk routes below already use
// -- same array-OR pattern authorizePermission already supports -- so a
// role that only ever had blanket setup permission keeps working exactly as
// before, while a role that's granted the new granular "vendor" key (not
// done by this patch -- see setupPermissionMapping["Vendor Name"] in the
// frontend's Dashboard/index.tsx) can be scoped to vendors without the rest
// of setup.
router.post("/create", authorizePermission(["vendor", "setup"], "create"), validate(createVendorSchema), VendorController.createVendor);

router.get("/getall", VendorController.getVendors);

router.get("/getbyid/:id", VendorController.getVendorById);

router.patch("/update/:id", authorizePermission(["vendor", "setup"], "edit"), validate(updateVendorSchema), VendorController.updateVendor);

router.delete("/delete/:id", authorizePermission(["vendor", "setup"], "delete"), VendorController.deleteVendor);

router.post('/bulk', authorizePermission(["vendor", "setup"], "create"), upload.single('file'), VendorController.bulkCreateVendors);

// §77: CSV template download for the bulk-import format above.
router.get('/bulk/template', VendorController.downloadVendorTemplate);

// Module 11 Part B: read-only, live-computed -- no dedicated permission
// key, reuses view access to the vendor record itself.
router.get('/:id/rate-history', VendorController.getVendorRateHistory);
router.get('/:id/performance', VendorController.getVendorPerformance);

module.exports = router;