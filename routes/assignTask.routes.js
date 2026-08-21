const express = require("express");
const AssignTaskController = require("../controllers/assignTask.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const router = express.Router();

router.use(authenticateToken);

// Create a new assign task
router.post("/create", AssignTaskController.createAssignTask);

// Get all assign tasks
router.get("/getall", AssignTaskController.getAllAssignTasks);

// Get a single assign task by ID
router.get("/getbyid/:id", AssignTaskController.getAssignTaskById);
router.get("/getbystaffid/:id", AssignTaskController.getTasksByStaffId);

// Update an assign task by ID
router.patch("/update/:id", AssignTaskController.updateAssignTask);

// Update assign task status
router.patch("/updatestatus/:id", authorizePermission("assign_task", "edit"), AssignTaskController.updateAssignTaskStatus);

// Delete an assign task by ID
router.delete("/delete/:id", authorizePermission("assign_task", "delete"), AssignTaskController.deleteAssignTask);

// Get party names by company name for dropdown
router.get("/party-names", AssignTaskController.getPartyNamesByCompany);

module.exports = router;