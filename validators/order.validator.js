const { z } = require("zod");

// Structural validation only — id-existence, rate/type business rules,
// etc. remain in the controller. This catches malformed payloads early.
const idField = z.union([z.string(), z.number()]);

const createOrderSchema = z.object({
  companyName: idField,
  party: idField,
  productItem: idField,
  qty: z.union([z.string(), z.number()]).refine(
    (v) => !isNaN(Number(v)) && Number(v) > 0,
    "Quantity must be a positive number"
  ),
  remarks: z.string().optional(),
  filePaths: z.any().optional(),
  createdBy: idField.optional(),
  isGst: z.boolean().optional(),
  size: z.string().optional(),
  rate: z.union([z.string(), z.number()]).optional(),
  rateType: z.enum(["old", "new"]).optional(),
  isLamination: z.boolean().optional(),
  laminationType: z.enum(["Matte", "Gloss"]).optional(),
});

// Update payloads are partial — any subset of the above fields, still
// type-checked when present.
const updateOrderSchema = createOrderSchema.partial();

module.exports = { createOrderSchema, updateOrderSchema };
