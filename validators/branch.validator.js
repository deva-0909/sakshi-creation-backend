const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);

const createBranchSchema = z.object({
  branchName: z.string().min(1, "Branch name is required"),
  companyName: idField.optional(),
  address: z.string().optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
});

const updateBranchSchema = createBranchSchema.partial();

module.exports = { createBranchSchema, updateBranchSchema };
