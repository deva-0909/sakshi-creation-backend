const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const numericField = z.union([z.string(), z.number()]).refine((v) => !isNaN(Number(v)), "Must be a number");

const rfqItemSchema = z.object({
  materialId: idField,
  quantityNeeded: numericField.refine((v) => Number(v) > 0, "quantityNeeded must be a positive number"),
});

const createRfqSchema = z.object({
  companyName: idField,
  notes: z.string().optional(),
  items: z.array(rfqItemSchema).min(1, "At least one material line is required"),
  vendorIds: z.array(idField).min(1, "At least one vendor must be invited"),
});

const quoteItemSchema = z.object({
  rfqItemId: idField,
  rate: numericField.refine((v) => Number(v) > 0, "rate must be a positive number"),
  notes: z.string().optional(),
});

const recordVendorQuoteSchema = z.object({
  items: z.array(quoteItemSchema).min(1, "At least one quoted rate is required"),
});

const selectWinningQuoteSchema = z.object({
  expectedDate: z.string().optional(),
  notes: z.string().optional(),
});

module.exports = {
  createRfqSchema,
  recordVendorQuoteSchema,
  selectWinningQuoteSchema,
};
