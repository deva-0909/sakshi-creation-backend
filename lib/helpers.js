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

module.exports = {
  isValidId,
  hashPassword,
  comparePassword,
  withMongoId,
  maskAadhar,
};
