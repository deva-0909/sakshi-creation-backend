const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const numericField = z.union([z.string(), z.number()]).refine((v) => !isNaN(Number(v)), "Must be a number");

const grnItemSchema = z.object({
  purchaseOrderItemId: idField,
  materialId: idField,
  quantityReceived: numericField.refine((v) => Number(v) > 0, "quantityReceived must be a positive number"),
  rate: numericField.refine((v) => Number(v) > 0, "rate must be a positive number"),
});

const createGrnSchema = z.object({
  purchaseOrderId: idField,
  receivedDate: z.string().min(1, "receivedDate is required"),
  forRole: idField,
  forCompany: idField,
  notes: z.string().optional(),
  items: z.array(grnItemSchema).min(1, "At least one received line is required"),
  // Module 11 Part B: supplier invoice reference, both optional.
  vendorInvoiceNumber: z.string().trim().optional(),
  vendorInvoiceDate: z.string().optional(),
});

module.exports = { createGrnSchema };
