const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const numericField = z.union([z.string(), z.number()]).refine((v) => !isNaN(Number(v)), "Must be a number");

const returnItemSchema = z.object({
  grnItemId: idField,
  quantityReturned: numericField.refine((v) => Number(v) > 0, "quantityReturned must be a positive number"),
});

const createPurchaseReturnSchema = z.object({
  grnId: idField,
  forRole: idField,
  forCompany: idField,
  returnDate: z.string().optional(),
  reason: z.string().min(1, "reason is required"),
  notes: z.string().optional(),
  items: z.array(returnItemSchema).min(1, "At least one returned line is required"),
});

module.exports = { createPurchaseReturnSchema };
