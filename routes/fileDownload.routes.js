const express = require("express")
const router = express.Router()
const { downloadFile, getFileInfo, listFiles } = require("../controllers/fileDownloadController")

router.get("/download", downloadFile)

// Get file info route
router.get("/info/:filePath(*)", getFileInfo)

// List files in directory route
router.get("/list/:directory(*)?", listFiles)

module.exports = router
