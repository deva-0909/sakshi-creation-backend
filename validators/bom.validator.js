const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const numericField = z.union([z.string(), z.number()]).refine(
  (v) => !isNaN(Number(v)) && Number(v) > 0,
  "Must be a positive number"
);

const percentField = z.union([z.string(), z.number()]).refine(
  (v) => !isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 100,
  "Must be a number between 0 and 100"
);

const createBomSchema = z.object({
  productItem: idField,
  material: idField,
  quantityPerUnit: numericField,
  unit: z.string().optional(),
  // Module 10: optional UOM master link, alongside the existing free-text
  // `unit` field (kept for backward compatibility).
  uom: idField.optional(),
  notes: z.string().optional(),
  // Module 8: lets the wastage report compare actual wastage against a
  // plan instead of floating with nothing to measure it against.
  expectedWastagePercent: percentField.optional(),
});

const updateBomSchema = createBomSchema.partial();

module.exports = { createBomSchema, updateBomSchema };
