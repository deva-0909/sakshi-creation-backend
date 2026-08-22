const supabase = require("./supabaseClient");
const { sendMail } = require("./mailer");

// Every staff member whose role currently holds 'approve' permission for
// the given module (e.g. "quotation", "purchaseorder") -- matches the
// exact structure authorizePermission() itself checks
// (roles.permissions[moduleKey].approve === true), read via a jsonb
// containment query rather than pulling every role into JS to filter.
async function getApprovers(moduleKey, excludeStaffId) {
  try {
    const { data: roles, error: rolesError } = await supabase
      .from("roles")
      .select("id")
      .eq("is_delete", false)
      .contains("permissions", { [moduleKey]: { approve: true } });
    if (rolesError || !roles?.length) return [];

    const { data: staffRows, error: staffError } = await supabase
      .from("staff")
      .select("id")
      .in(
        "role_id",
        roles.map((r) => r.id)
      )
      .eq("is_delete", false);
    if (staffError || !staffRows) return [];

    return staffRows.map((s) => s.id).filter((id) => id && id !== excludeStaffId);
  } catch (error) {
    console.error("getApprovers failed:", error.message);
    return [];
  }
}

// Writes one notifications row per recipient and, best-effort, emails each
// recipient with an email on file. Never throws -- a notification failure
// must never fail the mutation it's describing.
async function notifyStaff({ recipientIds, type, title, message, entityType, entityId, link }) {
  try {
    const ids = [...new Set((recipientIds || []).filter(Boolean))];
    if (!ids.length) return;

    const rows = ids.map((recipientId) => ({
      recipient_staff_id: recipientId,
      type,
      title,
      message: message || null,
      entity_type: entityType || null,
      entity_id: entityId != null ? String(entityId) : null,
      link: link || null,
    }));
    const { error } = await supabase.from("notifications").insert(rows);
    if (error) console.error("Notification insert failed:", error.message);

    const { data: recipients } = await supabase.from("staff").select("id, email").in("id", ids);
    await Promise.all((recipients || []).map((r) => sendMail({ to: r.email, subject: title, text: message || title })));
  } catch (error) {
    console.error("notifyStaff failed:", error.message);
  }
}

// Convenience wrapper for the common case of a status-changing action:
// notify the record's creator (unless they're the one making the change),
// and -- only when the new status is Pending Approval -- also notify
// every staff member who can approve this module, so approvals don't sit
// unseen (per the design decision: "creator + approvers").
async function notifyStatusChange({ moduleKey, entityType, entityId, creatorId, actorId, toStatus, title, message, link }) {
  const recipientIds = new Set();
  if (creatorId && creatorId !== actorId) recipientIds.add(creatorId);
  if (toStatus === "Pending Approval") {
    const approvers = await getApprovers(moduleKey, actorId);
    approvers.forEach((id) => recipientIds.add(id));
  }
  if (!recipientIds.size) return;
  await notifyStaff({ recipientIds: [...recipientIds], type: `${moduleKey}_status`, title, message, entityType, entityId, link });
}

module.exports = { getApprovers, notifyStaff, notifyStatusChange };
