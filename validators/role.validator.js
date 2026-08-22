const { z } = require("zod");

// Structural validation only — the duplicate role-name check stays in the
// controller.
const createRoleSchema = z.object({
  roleName: z.string().trim().min(1, "Role name is required and must be a non-empty string"),
  permissions: z.record(z.any()).optional(),
  status: z.string().optional(),
});

const updateRoleSchema = createRoleSchema.partial();

module.exports = { createRoleSchema, updateRoleSchema };
