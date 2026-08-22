const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const numericField = z.union([z.string(), z.number()]).refine((v) => !isNaN(Number(v)), "Must be a number");

// A credit note always ties to one invoice -- it exists to reduce what that
// specific invoice's party owes (design decision: "applies directly" on
// Issue, mirroring how a receipt updates amount_paid/status).
const createCreditNoteSchema = z.object({
  invoiceId: idField,
  amount: numericField.refine((v) => Number(v) > 0, "amount must be a positive number"),
  reason: z.string().trim().optional(),
});

module.exports = {
  createCreditNoteSchema,
};
