const express = require('express');
const PurchaseController = require('../controllers/purchase.controller');
const multer = require("multer");

const { authenticateToken } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { createPurchaseSchema, updatePurchaseSchema } = require("../validators/purchase.validator");
const router = express.Router();

router.use(authenticateToken);
const upload = multer({ storage: multer.memoryStorage() });
router.post("/create", validate(createPurchaseSchema), PurchaseController.createPurchase);

router.get("/getall", PurchaseController.getAllPurchases);

router.get("/getbyid/:id", PurchaseController.getPurchaseById);

router.patch("/update/:id", validate(updatePurchaseSchema), PurchaseController.updatePurchase);

router.delete("/delete/:id", PurchaseController.deletePurchase);

router.get("/getstaffbyrole/:roleId", PurchaseController.getStaffByRole);

router.get("/getbymaterial", PurchaseController.getPurchasesByMaterial);

router.get("/getbycompany", PurchaseController.getPurchasesByCompany);

router.get("/getbydaterange", PurchaseController.getPurchasesByDateRange);

router.post('/bulk', upload.single('file'), PurchaseController.bulkCreatePurchases);
module.exports = router;