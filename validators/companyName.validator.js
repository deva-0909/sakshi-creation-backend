const { z } = require("zod");

// Structural validation only — the uniqueness check against existing
// company names stays in the controller.
const createCompanyNameSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required"),
  avatar: z.string().trim().optional().nullable(),
});

const updateCompanyNameSchema = createCompanyNameSchema.partial();

module.exports = { createCompanyNameSchema, updateCompanyNameSchema };
