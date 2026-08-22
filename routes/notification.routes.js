const express = require("express");
const NotificationController = require("../controllers/notification.controller");

const { authenticateToken } = require("../middleware/auth");
const router = express.Router();

router.use(authenticateToken);

// Every route here is implicitly scoped to the caller (req.user.id) --
// no authorizePermission gate needed, same reasoning as the controller.
router.get("/", NotificationController.getMyNotifications);
router.get("/unread-count", NotificationController.getUnreadCount);
router.patch("/:id/read", NotificationController.markAsRead);
router.patch("/read-all", NotificationController.markAllAsRead);

module.exports = router;
