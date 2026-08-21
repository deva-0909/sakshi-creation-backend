const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);

// Structural validation only — the duplicate check against existing role
// departments stays in the controller.
const createRoleDepartmentSchema = z.object({
  roleDepartment: z.string().trim().min(1, "Role department is required"),
  CompanyName: idField,
});

// Update: the controller re-requires both fields, so this is not a
// .partial() of the create schema.
const updateRoleDepartmentSchema = createRoleDepartmentSchema;

module.exports = { createRoleDepartmentSchema, updateRoleDepartmentSchema };
