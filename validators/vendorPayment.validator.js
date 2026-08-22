const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const numericField = z.union([z.string(), z.number()]).refine((v) => !isNaN(Number(v)), "Must be a number");

const MODES = ["Cash", "Bank Transfer", "UPI", "Cheque", "Other"];

// purchaseOrderId is optional -- a payment can go against a specific PO,
// or be recorded as a general payment to a vendor (covers the older flat
// `purchases` flow, which has no PO concept, and one-off vendor payments).
const createVendorPaymentSchema = z.object({
  vendorId: idField,
  purchaseOrderId: idField.optional(),
  companyName: idField,
  amount: numericField.refine((v) => Number(v) > 0, "amount must be a positive number"),
  paymentDate: z.string().min(1, "paymentDate is required"),
  mode: z.enum(MODES),
  referenceNumber: z.string().trim().optional(),
  notes: z.string().optional(),
});

// Module 9: post one vendor payment split across multiple purchase orders.
const vendorPaymentAllocationSchema = z.object({
  purchaseOrderId: idField,
  amount: numericField.refine((v) => Number(v) > 0, "allocation amount must be a positive number"),
});

const createVendorPaymentAllocationSchema = z.object({
  vendorId: idField,
  companyName: idField,
  amount: numericField.refine((v) => Number(v) > 0, "amount must be a positive number"),
  paymentDate: z.string().min(1, "paymentDate is required"),
  mode: z.enum(MODES),
  referenceNumber: z.string().trim().optional(),
  notes: z.string().optional(),
  allocations: z.array(vendorPaymentAllocationSchema).min(1, "at least one allocation is required"),
});

module.exports = {
  createVendorPaymentSchema,
  createVendorPaymentAllocationSchema,
};
