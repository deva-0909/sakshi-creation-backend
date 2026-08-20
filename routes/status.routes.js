const express = require("express")
const router = express.Router()
const {
  createStatus,
  getAllStatuses,
  getStatusById,
  updateStatus,
  deleteStatus,
  getDefaultStatus,
  reorderStatuses,
} = require("../controllers/statusController")
const { authenticateToken } = require("../middleware/auth")


router.post("/:type/create", authenticateToken, createStatus)

router.get("/:type/all", authenticateToken, getAllStatuses)

router.get("/:type/default", authenticateToken, getDefaultStatus)

router.get("/:type/:id",authenticateToken, getStatusById)

router.put("/:type/update/:id",authenticateToken, updateStatus)

router.delete("/:type/delete/:id",authenticateToken, deleteStatus)

router.put("/:type/reorder",authenticateToken, reorderStatuses)

module.exports = router
