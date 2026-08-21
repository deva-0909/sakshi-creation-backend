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

module.exports = {
  isValidId,
  hashPassword,
  comparePassword,
  withMongoId,
};
