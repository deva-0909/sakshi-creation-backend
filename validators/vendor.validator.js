const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const numericField = z.union([z.string(), z.number()]).refine((v) => !isNaN(Number(v)), "Must be a number");

// Structural validation only — company-existence check stays in the
// controller.
const createVendorSchema = z.object({
  companyName: idField,
  name: z.string().trim().min(1, "Vendor name is required"),
  contactNumber: z.string().trim().min(1, "Contact number is required"),
  whatsappNumber: z.string().trim().min(1, "WhatsApp number is required"),
  gst: z.string().optional(),
  address: z.string().trim().min(1, "Address is required"),
  // Module 9: optional payable credit limit -- null/omitted means no limit
  // configured, so the "warn only" check (Section 7 of the design plan)
  // never fires for a vendor that hasn't had one set.
  creditLimit: numericField.refine((v) => Number(v) >= 0, "creditLimit must be zero or positive").optional(),
  // Module 10: generalized activation toggle -- see the activation-pattern
  // decision in remediation-patch-plan.md.
  status: z.string().optional(),
  // Module 11 Part B: banking/commercial terms -- all optional, additive.
  pan: z.string().trim().optional(),
  bankAccountNumber: z.string().trim().optional(),
  bankIfsc: z.string().trim().optional(),
  bankName: z.string().trim().optional(),
  paymentTerms: z.string().trim().optional(),
  creditPeriodDays: z.union([z.string(), z.number()]).refine((v) => Number.isInteger(Number(v)) && Number(v) >= 0, "creditPeriodDays must be a non-negative integer").optional(),
  vendorCategory: z.string().trim().optional(),
});

const updateVendorSchema = createVendorSchema.partial();

module.exports = { createVendorSchema, updateVendorSchema };
