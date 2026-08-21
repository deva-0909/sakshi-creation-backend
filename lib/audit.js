const supabase = require("./supabaseClient");

// Minimal audit trail. Fire-and-forget by design: a logging failure
// should never fail the actual mutation it's describing, so this never
// throws — it just logs a console warning and moves on.
//
// Usage: await logAudit({ req, action: "update", module: "staff",
//   recordId: staff.id, oldValue: before, newValue: after })
async function logAudit({ req, action, module, recordId, oldValue, newValue, userName }) {
  try {
    const { error } = await supabase.from("audit_logs").insert({
      user_id: req?.user?.id || null,
      user_name: userName || null,
      action,
      module,
      record_id: recordId != null ? String(recordId) : null,
      old_value: oldValue ?? null,
      new_value: newValue ?? null,
    });
    if (error) {
      console.error("Audit log insert failed:", error.message);
    }
  } catch (e) {
    console.error("Audit log insert threw:", e.message);
  }
}

module.exports = { logAudit };
