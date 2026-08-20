const express = require("express");
const productItemController = require("../controllers/productItem.controller");
const multer = require('multer');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/create", productItemController.createProductItem);

router.get("/getall", productItemController.getAllProductItems);

router.get("/getbyid/:id", productItemController.getProductItemById);

router.put("/update/:id", productItemController.updateProductItem);

router.delete("/delete/:id", productItemController.deleteProductItem);

router.post('/bulk', upload.single('file'), productItemController.bulkCreateProductItems);

module.exports = router;