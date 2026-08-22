const express = require("express");
const RoutingController = require("../controllers/routing.controller");
const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const {
  createProcessStageSchema,
  updateProcessStageSchema,
  createRoutingTemplateSchema,
  updateRoutingTemplateSchema,
} = require("../validators/routing.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/stages", authorizePermission("routing", "create"), validate(createProcessStageSchema), RoutingController.createProcessStage);
router.get("/stages", RoutingController.getAllProcessStages);
router.patch("/stages/:id", authorizePermission("routing", "edit"), validate(updateProcessStageSchema), RoutingController.updateProcessStage);
router.delete("/stages/:id", authorizePermission("routing", "delete"), RoutingController.deleteProcessStage);

router.post("/templates", authorizePermission("routing", "create"), validate(createRoutingTemplateSchema), RoutingController.createRoutingTemplate);
router.get("/templates", RoutingController.getAllRoutingTemplates);
router.get("/templates/suggested", RoutingController.getSuggestedRouting);
router.patch("/templates/:id", authorizePermission("routing", "edit"), validate(updateRoutingTemplateSchema), RoutingController.updateRoutingTemplate);
router.delete("/templates/:id", authorizePermission("routing", "delete"), RoutingController.deleteRoutingTemplate);

module.exports = router;
