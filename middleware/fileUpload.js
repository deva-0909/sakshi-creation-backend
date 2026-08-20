const multer = require("multer");

// Files are uploaded to Supabase Storage (see lib/storage.js), not local disk,
// since serverless deployments (Vercel) have no persistent/writable filesystem.
// Keep everything in memory as a Buffer; controllers upload the buffer themselves.
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => cb(null, true),
  limits: {
    files: 10,
    fileSize: 10 * 1024 * 1024, // 10MB per file
  },
});

module.exports = upload;
