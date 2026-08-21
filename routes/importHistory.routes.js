const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const { getImportHistory } = require("../controllers/importHistory.controller");

router.use(authenticateToken);

router.get("/:module", getImportHistory);

module.exports = router;
