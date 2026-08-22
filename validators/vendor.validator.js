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
});

const updateVendorSchema = createVendorSchema.partial();

module.exports = { createVendorSchema, updateVendorSchema };
