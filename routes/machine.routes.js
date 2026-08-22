const express = require("express");
const MachineController = require("../controllers/machine.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createMachineSchema, updateMachineSchema } = require("../validators/machine.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("machine", "create"), validate(createMachineSchema), MachineController.createMachine);
router.get("/", MachineController.getAllMachines);
router.get("/:id", MachineController.getMachineById);
router.patch("/:id", authorizePermission("machine", "edit"), validate(updateMachineSchema), MachineController.updateMachine);
router.delete("/:id", authorizePermission("machine", "delete"), MachineController.deleteMachine);

module.exports = router;
