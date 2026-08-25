const express = require("express");
const DyePunchController = require("../controllers/dyePunch.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createDyePunchSchema, updateDyePunchSchema } = require("../validators/dyePunch.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("dye_punch", "create"), validate(createDyePunchSchema), DyePunchController.createDyePunch);
router.get("/", DyePunchController.getAllDyePunches);
router.get("/:id", DyePunchController.getDyePunchById);
router.patch("/:id", authorizePermission("dye_punch", "edit"), validate(updateDyePunchSchema), DyePunchController.updateDyePunch);
router.delete("/:id", authorizePermission("dye_punch", "delete"), DyePunchController.deleteDyePunch);

module.exports = router;
