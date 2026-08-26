const express = require("express");
const GrnController = require("../controllers/grn.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission, authorizeView } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createGrnSchema } = require("../validators/grn.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("grn", "create"), validate(createGrnSchema), GrnController.createGrn);
router.get("/", authorizeView("grn", "created_by"), GrnController.getAllGrns);
router.get("/:id", GrnController.getGrnById);

module.exports = router;
