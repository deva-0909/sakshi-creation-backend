const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const numberField = z.union([z.number(), z.string()]);

// Structural validation only — order/company/party existence checks stay
// in the controller.
const createPerformanceInvoiceSchema = z.object({
  orderNumber: z.union([z.string(), z.number()]).refine((v) => String(v).trim().length > 0, "Order number is required"),
  companyName: idField,
  partyName: idField,
  quantity: numberField,
  color: z.string().trim().optional().nullable(),
  size: z.string().trim().optional().nullable(),
  pType: z.string().trim().optional().nullable(),
  assignedTo: idField.optional().nullable(),
  unitPrice: numberField.optional().nullable(),
  applyGST: z.boolean().optional(),
  gstPercentage: numberField.optional().nullable(),
  GSTNo: z.string().trim().optional().nullable(),
  partyAddress: z.any().optional(),
  servicePerformance: z.string().trim().min(1, "Service performance is required"),
  daysAfterConfirmation: numberField.optional().nullable(),
  paymentTerms: z.string().trim().optional().nullable(),
  signature: z.string().trim().optional().nullable(),
});

// Update: the controller re-requires the same core fields as create
// (orderNumber, companyName, partyName, quantity, servicePerformance), so
// this is NOT a .partial() of the create schema.
const updatePerformanceInvoiceSchema = createPerformanceInvoiceSchema;

module.exports = { createPerformanceInvoiceSchema, updatePerformanceInvoiceSchema };
