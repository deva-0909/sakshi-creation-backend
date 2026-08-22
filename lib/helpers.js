const bcrypt = require("bcryptjs");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidId(id) {
  return typeof id === "string" && UUID_REGEX.test(id);
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

async function comparePassword(plain, hash) {
  try {
    return await bcrypt.compare(plain, hash);
  } catch (e) {
    return false;
  }
}

// Adds a Mongo-style `_id` alias (string) alongside the Postgres `id`
// so the existing frontend (built against Mongoose responses) keeps working.
// Recurses into nested objects/arrays (e.g. order.party, order.designer)
// so relation objects also get `_id`, not just the top-level row.
function withMongoId(row) {
  if (!row || typeof row !== "object") return row;
  if (Array.isArray(row)) return row.map(withMongoId);
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value && typeof value === "object" ? withMongoId(value) : value;
  }
  if (typeof out.id !== "undefined") {
    out._id = out.id;
  }
  return out;
}

// Masks all but the last 4 digits of an Aadhar number for list/bulk
// responses, where the full number isn't needed and enumerating the staff
// list would otherwise expose everyone's Aadhar in one call.
function maskAadhar(aadharNo) {
  if (!aadharNo || typeof aadharNo !== "string") return aadharNo;
  const digits = aadharNo.replace(/\D/g, "");
  if (digits.length < 4) return "XXXX-XXXX-XXXX";
  const last4 = digits.slice(-4);
  return `XXXX-XXXX-${last4}`;
}

// Derives a 2-letter prefix from a company name for order/quotation/
// job-card numbering (e.g. "Sakshi Creation" -> "SC"). Was duplicated
// inline in order.controller.js; centralized here so the new quotation
// and job-card numbering (Patch 16) uses the exact same logic rather
// than a second copy that could drift.
function deriveInitials(companyName) {
  const words = (companyName || "").trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return (words[0] || "").substring(0, 2).toUpperCase();
}

// Maps a role name to the inventory category buckets purchases/inventory
// already use (printer/binder/booklet/factory). Was duplicated inline in
// purchase.controller.js; centralized here so job-card material-usage
// recording (Patch 16) derives the same category the exact same way.
function categoryForRole(roleName) {
  const r = (roleName || "").toLowerCase();
  if (r.includes("printer")) return "printer";
  if (r.includes("binder")) return "binder";
  if (r.includes("booklet")) return "booklet";
  return "factory";
}

// Maps a job-card stage name to the same inventory category buckets --
// used only for wastage recording (Module 8), where the stage itself
// (not a staff member's role) tells us where the material was lost.
function categoryForStage(stage) {
  const s = (stage || "").toLowerCase();
  if (s.includes("printer")) return "printer";
  if (s.includes("binder")) return "binder";
  if (s.includes("booklet")) return "booklet";
  return "factory";
}

module.exports = {
  isValidId,
  hashPassword,
  comparePassword,
  withMongoId,
  maskAadhar,
  deriveInitials,
  categoryForRole,
  categoryForStage,
};
