const express = require("express");
const productItemController = require("../controllers/productItem.controller");
const multer = require('multer');

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createProductItemSchema, updateProductItemSchema } = require("../validators/productItem.validator");
const router = express.Router();

router.use(authenticateToken);
const upload = multer({ storage: multer.memoryStorage() });

router.post("/create", validate(createProductItemSchema), productItemController.createProductItem);

router.get("/getall", productItemController.getAllProductItems);

router.get("/getbyid/:id", productItemController.getProductItemById);

router.put("/update/:id", validate(updateProductItemSchema), productItemController.updateProductItem);

router.delete("/delete/:id", authorizePermission("setup.products", "delete"), productItemController.deleteProductItem);

router.post('/bulk', authorizePermission("setup.products", "create"), upload.single('file'), productItemController.bulkCreateProductItems);

module.exports = router;