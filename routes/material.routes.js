const express = require("express");
const MaterialController = require("../controllers/material.controller");

const multer = require("multer");

const { authenticateToken } = require("../middleware/auth");
const router = express.Router();

router.use(authenticateToken);
const upload = multer({ storage: multer.memoryStorage() });
router.post("/create", MaterialController.createMaterial);

router.get("/getall", MaterialController.getAllMaterials);

router.get("/getbyid/:id", MaterialController.getMaterialById);

router.patch("/update/:id", MaterialController.updateMaterial);

router.delete("/delete/:id", MaterialController.deleteMaterial);

router.post('/bulk', upload.single('file'), MaterialController.bulkCreateMaterials);


module.exports = router;