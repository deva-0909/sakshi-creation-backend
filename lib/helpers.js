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
// already use (printer/binder/booklet/factory/godown -- see VALID_CATEGORIES
// in inventory.controller.js/stockLedger.controller.js). Was duplicated
// inline in purchase.controller.js; centralized here so job-card
// material-usage recording (Patch 16) derives the same category the exact
// same way.
//
// Two-company (QP order-process audit, 2026-08-25): this used to fall
// through to "factory" for anything that didn't match printer/binder/
// booklet -- silently miscategorizing every Godown-stage entry (QP's own
// final pipeline stage, not just an unrecognized value) into the Factory
// bucket even though a real "godown" category has existed since Module 11.
// Godown is now matched explicitly before the fallback.
//
// Sakshi Creation order-process audit (2026-08-25): the same fallback bug
// existed for SC's own Designer/QC/Delivery stages -- none of the three
// match printer/binder/booklet/godown, so they were silently landing in
// Factory too. Matched explicitly now, same as Godown was. See the matching
// VALID_CATEGORIES widening in inventory.controller.js/stockLedger.
// controller.js and the new inventory tabs in inventory/index.tsx.
function categoryForRole(roleName) {
  const r = (roleName || "").toLowerCase();
  if (r.includes("printer")) return "printer";
  if (r.includes("binder")) return "binder";
  if (r.includes("booklet")) return "booklet";
  if (r.includes("godown")) return "godown";
  if (r.includes("designer")) return "designer";
  if (r.includes("qc")) return "qc";
  if (r.includes("delivery")) return "delivery";
  return "factory";
}

// Maps a job-card stage name to the same inventory category buckets --
// used only for wastage recording (Module 8), where the stage itself
// (not a staff member's role) tells us where the material was lost.
// See categoryForRole's comment above -- same Godown fallback bug, same fix,
// now extended to SC's Designer/QC/Delivery stages too.
function categoryForStage(stage) {
  const s = (stage || "").toLowerCase();
  if (s.includes("printer")) return "printer";
  if (s.includes("binder")) return "binder";
  if (s.includes("booklet")) return "booklet";
  if (s.includes("godown")) return "godown";
  if (s.includes("designer")) return "designer";
  if (s === "qc" || s.includes("quality control")) return "qc";
  if (s.includes("delivery")) return "delivery";
  return "factory";
}

// Patch 131 (invoice/delivery linkage): pure comparison the order-linked
// invoice guard is built on -- kept side-effect-free and separate from the
// controller's Supabase calls so it's unit-testable without mocking the DB.
//
// Orders here have a single flat `qty` (no order_items table -- confirmed
// against the live schema), and delivery_challans.quantity_delivered is
// per-challan against an order_id (an order can have several partial-
// delivery challans). invoice_items.description is freeform text with no
// FK back to an order line item, so an order can only be reconciled at the
// order-total-quantity level, not per line item -- that's what this checks.
//
// Returns { ok: true, remaining } when requestedQty fits within what's left
// to invoice, or { ok: false, remaining, message } when it would push the
// invoiced total past what's actually been delivered for the order.
function evaluateInvoiceQuantityAgainstDelivery({ deliveredQty, alreadyInvoicedQty, requestedQty }) {
  const delivered = Number(deliveredQty) || 0;
  const alreadyInvoiced = Number(alreadyInvoicedQty) || 0;
  const requested = Number(requestedQty) || 0;
  const remaining = delivered - alreadyInvoiced;

  if (requested > remaining) {
    return {
      ok: false,
      remaining,
      message:
        `This invoice's line items total ${requested} unit(s), but only ${remaining} unit(s) of this order remain un-invoiced ` +
        `(${delivered} delivered so far, ${alreadyInvoiced} already invoiced). Reduce the quantity or wait for further delivery.`,
    };
  }
  return { ok: true, remaining };
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
  evaluateInvoiceQuantityAgainstDelivery,
};
