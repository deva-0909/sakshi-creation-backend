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
  updateStaffStatus
} = require("../controllers/order.controller");
const { authenticateToken } = require("../middleware/auth");

router.post("/create", authenticateToken, createOrder);

router.get("/all", getAllOrders);
router.get("/getbystaffid/:id", getOrdersByStaffId);

router.get("/printer", authenticateToken, getPrinterById);

router.get("/binder", authenticateToken, getBinderById);

router.get("/bookletBinder", authenticateToken, getBookletBinderById);

router.put("/:orderId/status", updateStaffStatus);

router.get("/designe", authenticateToken, getDesignerById);

router.get("/:id", getOrderById);

router.put("/update/:id", updateOrder);

router.delete("/delete/:id", deleteOrder);

router.get("/company/:companyId/party/:partyId", getOrdersByCompanyAndParty);

module.exports = router;
