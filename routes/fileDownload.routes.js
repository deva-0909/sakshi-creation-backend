const express = require("express")
const router = express.Router()
const { downloadFile, getFileInfo, listFiles } = require("../controllers/fileDownloadController")
const { authenticateTokenOrQuery } = require("../middleware/auth")

// These are hit via direct browser navigation/img-src/window.open
// throughout the frontend, which can't attach an Authorization header —
// so auth here accepts the token as a query param too. See
// authenticateTokenOrQuery in middleware/auth.js.
router.use(authenticateTokenOrQuery)

router.get("/download", downloadFile)

// Get file info route
router.get("/info/:filePath(*)", getFileInfo)

// List files in directory route
router.get("/list/:directory(*)?", listFiles)

module.exports = router
