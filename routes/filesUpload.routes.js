const express = require("express")
const router = express.Router()
const upload = require("../middleware/fileUpload")
const multer = require("multer")
const {
  uploadSingleFile,
  uploadMultipleFiles,
  deleteFile,
  getFileInfo,
  listUploads, // Add this new function
} = require("../controllers/fileUploadController")

// Upload single file
router.post("/single", upload.single("file"), uploadSingleFile)

// Upload multiple files
router.post("/multiple", upload.array("files", 10), uploadMultipleFiles)

// Delete file
router.delete("/:folder/:filename", deleteFile)

// Get file info
router.get("/info/:folder/:filename", getFileInfo)

// List all uploads (for debugging)
router.get("/list", listUploads)

// Error handling middleware for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "File size too large. Maximum size allowed is 5MB per file.",
      })
    }
    if (error.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        success: false,
        message: "Too many files. Maximum 10 files allowed at once.",
      })
    }
  }
  res.status(400).json({
    success: false,
    message: error.message || "File upload error",
  })
})

module.exports = router
