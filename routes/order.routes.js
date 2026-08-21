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

router.use(authenticateToken);

router.post("/create", createOrder);

router.get("/all", getAllOrders);
router.get("/getbystaffid/:id", getOrdersByStaffId);

router.get("/printer", getPrinterById);

router.get("/binder", getBinderById);

router.get("/bookletBinder", getBookletBinderById);

router.put("/:orderId/status", updateStaffStatus);

router.get("/designe", getDesignerById);

router.get("/:id", getOrderById);

router.put("/update/:id", updateOrder);

router.delete("/delete/:id", deleteOrder);

router.get("/company/:companyId/party/:partyId", getOrdersByCompanyAndParty);

module.exports = router;
