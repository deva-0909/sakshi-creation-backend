const { z } = require("zod");

// Structural validation only — the uniqueness check against existing
// company names stays in the controller.
const createCompanyNameSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required"),
  avatar: z.string().trim().optional().nullable(),
  // Used by the invoicing module (Module 4) to auto-determine CGST/SGST
  // vs IGST by comparing this company's state to the billed party's state.
  state: z.string().trim().optional().nullable(),
  status: z.string().optional(),
});

const updateCompanyNameSchema = createCompanyNameSchema.partial();

module.exports = { createCompanyNameSchema, updateCompanyNameSchema };
