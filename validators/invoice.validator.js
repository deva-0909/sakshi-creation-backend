const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const numericField = z.union([z.string(), z.number()]).refine((v) => !isNaN(Number(v)), "Must be a number");

const invoiceItemSchema = z.object({
  description: z.string().trim().min(1, "description is required"),
  hsnCode: z.string().trim().optional(),
  quantity: numericField.refine((v) => Number(v) > 0, "quantity must be a positive number"),
  unitPrice: numericField.refine((v) => Number(v) > 0, "unitPrice must be a positive number"),
  gstRate: numericField.refine((v) => Number(v) >= 0, "gstRate cannot be negative"),
});

// gstType is not client-supplied -- it's auto-derived server-side by
// comparing the company's and party's state fields (see invoice.controller.js).
const createInvoiceSchema = z.object({
  companyName: idField,
  partyId: idField,
  orderId: idField.optional(),
  quotationId: idField.optional(),
  invoiceDate: z.string().min(1, "invoiceDate is required"),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(invoiceItemSchema).min(1, "At least one line item is required"),
});

module.exports = {
  createInvoiceSchema,
};
