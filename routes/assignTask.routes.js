const express = require("express");
const AssignTaskController = require("../controllers/assignTask.controller");

const router = express.Router();

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
router.patch("/updatestatus/:id", AssignTaskController.updateAssignTaskStatus);

// Delete an assign task by ID
router.delete("/delete/:id", AssignTaskController.deleteAssignTask);

// Get party names by company name for dropdown
router.get("/party-names", AssignTaskController.getPartyNamesByCompany);

module.exports = router;