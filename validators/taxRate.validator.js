const { z } = require("zod");

const numericField = z.union([z.string(), z.number()]).refine((v) => !isNaN(Number(v)), "Must be a number");

const createTaxRateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  ratePercent: numericField.refine((v) => Number(v) >= 0, "Rate must be non-negative"),
  isDefault: z.boolean().optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
});

const updateTaxRateSchema = createTaxRateSchema.partial();

module.exports = { createTaxRateSchema, updateTaxRateSchema };
