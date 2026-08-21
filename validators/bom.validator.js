const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const numericField = z.union([z.string(), z.number()]).refine(
  (v) => !isNaN(Number(v)) && Number(v) > 0,
  "Must be a positive number"
);

const createBomSchema = z.object({
  productItem: idField,
  material: idField,
  quantityPerUnit: numericField,
  unit: z.string().optional(),
  notes: z.string().optional(),
});

const updateBomSchema = createBomSchema.partial();

module.exports = { createBomSchema, updateBomSchema };
