const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const numericField = z.union([z.string(), z.number()]).refine(
  (v) => !isNaN(Number(v)),
  "Must be a number"
);

// Structural validation only — id-existence checks stay in the
// controller, matching every other validator in this app.
const createQuotationSchema = z.object({
  companyName: idField,
  party: idField,
  productItem: idField,
  qty: numericField.refine((v) => Number(v) > 0, "Quantity must be a positive number"),
  size: z.string().optional(),
  specs: z.record(z.string(), z.any()).optional(),
  rateType: z.enum(["old", "new"]).optional(),
  rate: numericField.optional(),
  printingrate: numericField.optional(),
  isGst: z.boolean().optional(),
  gstPercentage: numericField.optional(),
  totalAmount: numericField.optional(),
  validUntil: z.string().optional(),
  remarks: z.string().optional(),
});

// Only Draft quotations can be edited (enforced in the controller); the
// shape itself is the same fields, all optional.
const updateQuotationSchema = createQuotationSchema.partial();

const rejectQuotationSchema = z.object({
  remarks: z.string().min(1, "A reason is required to reject a quotation"),
});

const respondQuotationSchema = z.object({
  response: z.enum(["Accepted", "Rejected"]),
  remarks: z.string().optional(),
});

module.exports = {
  createQuotationSchema,
  updateQuotationSchema,
  rejectQuotationSchema,
  respondQuotationSchema,
};
