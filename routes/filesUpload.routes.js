const express = require("express")
const router = express.Router()
const upload = require("../middleware/fileUpload")
const multer = require("multer")
const { authenticateToken } = require("../middleware/auth")
const { authorizePermission } = require("../middleware/authorize")
const {
  uploadSingleFile,
  uploadMultipleFiles,
  deleteFile,
  getFileInfo,
  listUploads, // Add this new function
} = require("../controllers/fileUploadController")

// The frontend already sends Authorization on every call to these
// endpoints (src/services/fileUpload.service.ts), so plain header auth
// is safe here — unlike fileDownload.routes.js, nothing hits these via
// direct browser navigation.
router.use(authenticateToken)

// Upload single file
router.post("/single", upload.single("file"), uploadSingleFile)

// Upload multiple files
router.post("/multiple", upload.array("files", 10), uploadMultipleFiles)

// Delete file — no dedicated "uploads" permission key exists, falls back
// to the generic setup bucket. Previously any authenticated user could
// delete any file in the shared bucket; now it requires the same
// delete-level permission destructive setup operations already require.
router.delete("/:folder/:filename", authorizePermission("setup", "delete"), deleteFile)

// Get file info
router.get("/info/:folder/:filename", getFileInfo)

// List all uploads — enumerates every folder/file in the bucket across
// the whole app. Was open to any authenticated user despite being
// labeled "for debugging"; now gated the same way as other setup-level
// read operations without a dedicated permission key.
router.get("/list", authorizePermission("setup", "view_global"), listUploads)

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
    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        success: false,
        message: "Unsupported file type. Allowed: PDF, JPG, PNG, XLSX, XLS, CSV, DOC, DOCX.",
      })
    }
  }
  res.status(400).json({
    success: false,
    message: error.message || "File upload error",
  })
})

module.exports = router
