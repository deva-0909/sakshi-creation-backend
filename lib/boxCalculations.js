// Quality Packaging box-costing follow-up (2026-08-25 audit, rebuilt
// 2026-08-27 as Patch 101 after Patch 89's original backend implementation
// was found to have never actually landed on origin/main): the QP box-
// manufacturing/Kantan/costing audit (claude/qp-box-manufacturing-kantan-figma-audit.md)
// found that neither the Figma design nor the codebase contained a working
// Kantan calculation or a box cost/quotation formula anywhere -- every
// "amount" field in the design was a static, non-reconciling mockup number.
// These two formulas were confirmed directly with the user (not invented):
//
//   Kantan length (cm) = 2 x (box length_cm + box width_cm)
//     -- a plain perimeter calculation, no allowance added, dimensions in cm.
//
//   Estimated box cost = surface area (m^2) x GSM x ply x paper rate
//     -- "paper rate" is the paper material's existing `rate_per_sheet`
//     purchase rate (the only rate the schema actually has -- there is no
//     true per-kg rate anywhere), used directly with no unit conversion, per
//     the user's explicit choice. This makes the result a self-consistent
//     relative cost index across orders, not a literal rupees-per-kilogram
//     calculation -- documented here so a future reader doesn't assume more
//     precision than was agreed.
//
// Both functions return null (never 0 or NaN) when an input is missing or
// invalid, so callers can tell "not enough data to estimate" apart from a
// real zero -- the same convention costing.controller.js's latestRate()
// already uses for missing purchase-rate data.

function toPositiveNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!isFinite(n) || n <= 0) return null;
  return n;
}

// Kantan length (cm) = 2 x (length + width). Only length/width matter --
// height doesn't factor into the perimeter the Kantan wraps around.
function computeKantanLengthCm({ lengthCm, widthCm }) {
  const l = toPositiveNumber(lengthCm);
  const w = toPositiveNumber(widthCm);
  if (l === null || w === null) return null;
  return Number((2 * (l + w)).toFixed(2));
}

// Estimated box cost = surface area (m^2) x GSM x ply x paper rate_per_sheet.
// Surface area uses the full cuboid surface (all 6 faces: 2*(LW + LH + WH)),
// converted cm^2 -> m^2 (divide by 10,000), since that's the actual amount
// of paper material a box's construction consumes, not just its footprint.
function computeEstimatedBoxCost({ lengthCm, widthCm, heightCm, gsm, ply, ratePerSheet }) {
  const l = toPositiveNumber(lengthCm);
  const w = toPositiveNumber(widthCm);
  const h = toPositiveNumber(heightCm);
  const gsmNum = toPositiveNumber(gsm);
  const plyNum = toPositiveNumber(ply);
  const rate = toPositiveNumber(ratePerSheet);
  if (l === null || w === null || h === null || gsmNum === null || plyNum === null || rate === null) {
    return null;
  }
  const surfaceAreaCm2 = 2 * (l * w + l * h + w * h);
  const surfaceAreaM2 = surfaceAreaCm2 / 10000;
  const cost = surfaceAreaM2 * gsmNum * plyNum * rate;
  return Number(cost.toFixed(2));
}

module.exports = { computeKantanLengthCm, computeEstimatedBoxCost };
