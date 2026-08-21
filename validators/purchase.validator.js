const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const numericField = z.union([z.string(), z.number()]).refine(
  (v) => !isNaN(Number(v)),
  "Must be a number"
);

// Structural validation only — uniqueness/existence checks stay in the
// controller.
const createPurchaseSchema = z.object({
  vendorName: idField,
  billNumber: z.union([z.string(), z.number()]),
  material: idField,
  quantity: numericField,
  ratePerSheet: numericField,
  kg: numericField,
  companyName: idField,
  for: idField,
  forCompany: idField,
});

const updatePurchaseSchema = createPurchaseSchema.partial();

module.exports = { createPurchaseSchema, updatePurchaseSchema };
