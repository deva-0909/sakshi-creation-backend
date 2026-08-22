const express = require("express");
const BranchController = require("../controllers/branch.controller");
const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createBranchSchema, updateBranchSchema } = require("../validators/branch.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("branch", "create"), validate(createBranchSchema), BranchController.createBranch);
router.get("/", BranchController.getAllBranches);
router.patch("/:id", authorizePermission("branch", "edit"), validate(updateBranchSchema), BranchController.updateBranch);
router.delete("/:id", authorizePermission("branch", "delete"), BranchController.deleteBranch);

module.exports = router;
