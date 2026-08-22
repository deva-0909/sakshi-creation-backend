const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const numericField = z.union([z.string(), z.number()]).refine((v) => !isNaN(Number(v)), "Must be a number");

const MODES = ["Cash", "Bank Transfer", "UPI", "Cheque", "Other"];

// invoiceId is optional -- an unallocated advance receipt against a party
// is valid, matching the design decision that invoices needn't always be
// the origin of a payment.
const createReceiptSchema = z.object({
  invoiceId: idField.optional(),
  partyId: idField,
  companyName: idField,
  amount: numericField.refine((v) => Number(v) > 0, "amount must be a positive number"),
  paymentDate: z.string().min(1, "paymentDate is required"),
  mode: z.enum(MODES),
  referenceNumber: z.string().trim().optional(),
  notes: z.string().optional(),
});

// Module 9: post one receipt split across multiple invoices. Each allocation
// must reference a real invoiceId and a positive amount; the sum is checked
// against the receipt's total amount server-side (in the controller/RPC),
// not here, since that needs a DB read.
const receiptAllocationSchema = z.object({
  invoiceId: idField,
  amount: numericField.refine((v) => Number(v) > 0, "allocation amount must be a positive number"),
});

const createReceiptAllocationSchema = z.object({
  partyId: idField,
  companyName: idField,
  amount: numericField.refine((v) => Number(v) > 0, "amount must be a positive number"),
  paymentDate: z.string().min(1, "paymentDate is required"),
  mode: z.enum(MODES),
  referenceNumber: z.string().trim().optional(),
  notes: z.string().optional(),
  allocations: z.array(receiptAllocationSchema).min(1, "at least one allocation is required"),
});

module.exports = {
  createReceiptSchema,
  createReceiptAllocationSchema,
};
