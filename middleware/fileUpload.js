const multer = require("multer");
const path = require("path");

// Files are uploaded to Supabase Storage (see lib/storage.js), not local disk,
// since serverless deployments (Vercel) have no persistent/writable filesystem.
// Keep everything in memory as a Buffer; controllers upload the buffer themselves.

// Explicit allow-list — covers everything the app actually uses uploads for
// (aadhar/address proofs, design/print files, bulk-import sheets). Anything
// else (executables, scripts, etc.) is rejected before it ever reaches
// storage.
const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".jpg", ".jpeg", ".png", ".xlsx", ".xls", ".csv", ".docx", ".doc",
]);
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
  }
  cb(null, true);
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    files: 10,
    fileSize: 10 * 1024 * 1024, // 10MB per file
  },
});

module.exports = upload;
