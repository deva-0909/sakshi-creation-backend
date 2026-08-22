// Best-effort email leg for Notifications (Module 5). In-app notifications
// (the "notifications" table) always work regardless of this file; email
// is an optional add-on that activates automatically once SMTP_HOST/
// SMTP_USER/SMTP_PASS are set as environment variables -- until then this
// silently no-ops so the rest of the notification flow is unaffected.
let transporter = null;
let attemptedInit = false;

function getTransporter() {
  if (attemptedInit) return transporter;
  attemptedInit = true;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn("Email notifications disabled: SMTP_HOST/SMTP_USER/SMTP_PASS are not set. In-app notifications are unaffected.");
    return null;
  }
  const nodemailer = require("nodemailer");
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

// Never throws -- a failed/unconfigured email must never break the
// in-app notification write it accompanies. Returns false when SMTP
// isn't configured or the send itself fails, true on a successful send.
async function sendMail({ to, subject, text }) {
  try {
    const t = getTransporter();
    if (!t || !to) return false;
    await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text });
    return true;
  } catch (error) {
    console.error("sendMail failed:", error.message);
    return false;
  }
}

module.exports = { sendMail };
