const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const numericField = z.union([z.string(), z.number()]).refine((v) => !isNaN(Number(v)), "Must be a number");

// purchaseOrderId is optional -- a debit note (e.g. a quality-rejection
// credit from a vendor) can be tied to one PO or recorded as a general
// reduction of what's owed to that vendor.
const createDebitNoteSchema = z.object({
  vendorId: idField,
  purchaseOrderId: idField.optional(),
  companyName: idField,
  amount: numericField.refine((v) => Number(v) > 0, "amount must be a positive number"),
  reason: z.string().trim().optional(),
});

module.exports = {
  createDebitNoteSchema,
};
