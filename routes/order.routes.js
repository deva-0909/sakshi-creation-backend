const express = require("express");
const router = express.Router();
const {
  createOrder,
  getAllOrders,
  getOrderById,
  updateOrder,
  deleteOrder,
  getOrdersByCompanyAndParty,
  getDesignerById,
  getPrinterById,
  getBinderById,
  getBookletBinderById,
  getOrdersByStaffId,
  updateStaffStatus,
  createOrderForm
} = require("../controllers/order.controller");
const { authenticateToken } = require("../middleware/auth");
const { authorizePermission, authorizeView } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createOrderSchema, updateOrderSchema, createOrderFormSchema } = require("../validators/order.validator");

router.use(authenticateToken);

router.post("/create", validate(createOrderSchema), createOrder);

// Order Form batch create (Godown Manager Figma audit, Patch 107): groups
// N order rows entered together via the multi-row inline form into one
// order_forms row. No extra permission gate beyond authenticateToken above,
// matching /create -- a batched way of doing the same action as a single
// order, which is likewise ungated here.
router.post("/create-form", validate(createOrderFormSchema), createOrderForm);

router.get("/all", authorizeView("all_orders", "created_by"), getAllOrders);
router.get("/getbystaffid/:id", getOrdersByStaffId);

router.get("/printer", getPrinterById);

router.get("/binder", getBinderById);

router.get("/bookletBinder", getBookletBinderById);

router.put("/:orderId/status", authorizePermission("all_orders", "edit"), updateStaffStatus);

router.get("/designe", getDesignerById);

router.get("/:id", getOrderById);

router.put("/update/:id", validate(updateOrderSchema), updateOrder);

router.delete("/delete/:id", authorizePermission("all_orders", "delete"), deleteOrder);

router.get("/company/:companyId/party/:partyId", getOrdersByCompanyAndParty);

module.exports = router;
