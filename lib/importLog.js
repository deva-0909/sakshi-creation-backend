const supabase = require("./supabaseClient");

// Bulk-import history + row-level error reporting (audit finding §77).
// Fire-and-forget by design, same as lib/audit.js's logAudit -- a
// logging failure should never fail (or roll back) the import it's
// describing, so this never throws.
//
// Usage: await logImport({ req, module: "vendor", fileName: file.originalname,
//   totalRows: rows.length, successCount, failedCount, errors: [{row, message}] })
async function logImport({ req, module, fileName, totalRows, successCount, failedCount, errors }) {
  try {
    const { error } = await supabase.from("import_logs").insert({
      module,
      file_name: fileName || null,
      total_rows: totalRows || 0,
      success_count: successCount || 0,
      failed_count: failedCount || 0,
      errors: errors || [],
      imported_by: req?.user?.id || null,
    });
    if (error) {
      console.error("Import log insert failed:", error.message);
    }
  } catch (e) {
    console.error("Import log insert threw:", e.message);
  }
}

module.exports = { logImport };
