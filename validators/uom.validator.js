const { z } = require("zod");

const createUomSchema = z.object({
  name: z.string().min(1, "Name is required"),
  symbol: z.string().optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
});

const updateUomSchema = createUomSchema.partial();

module.exports = { createUomSchema, updateUomSchema };
