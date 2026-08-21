const express = require("express");
const MaterialController = require("../controllers/material.controller");

const multer = require("multer");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createMaterialSchema, updateMaterialSchema } = require("../validators/material.validator");
const router = express.Router();

router.use(authenticateToken);
const upload = multer({ storage: multer.memoryStorage() });
router.post("/create", validate(createMaterialSchema), MaterialController.createMaterial);

router.get("/getall", MaterialController.getAllMaterials);

router.get("/getbyid/:id", MaterialController.getMaterialById);

router.patch("/update/:id", validate(updateMaterialSchema), MaterialController.updateMaterial);

router.delete("/delete/:id", authorizePermission("setup.paper-material", "delete"), MaterialController.deleteMaterial);

router.post('/bulk', authorizePermission("setup.paper-material", "create"), upload.single('file'), MaterialController.bulkCreateMaterials);


module.exports = router;