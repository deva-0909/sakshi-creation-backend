const express = require("express");
const DesignationController = require("../controllers/designation.controller");
const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createDesignationSchema, updateDesignationSchema } = require("../validators/designation.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("designation", "create"), validate(createDesignationSchema), DesignationController.createDesignation);
router.get("/", DesignationController.getAllDesignations);
router.patch("/:id", authorizePermission("designation", "edit"), validate(updateDesignationSchema), DesignationController.updateDesignation);
router.delete("/:id", authorizePermission("designation", "delete"), DesignationController.deleteDesignation);

module.exports = router;
