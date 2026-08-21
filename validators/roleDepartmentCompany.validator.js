const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);

// Structural validation only — role-department existence and the
// duplicate-name check stay in the controller.
const createRoleDepartmentCompanySchema = z.object({
  roleDepartment: idField,
  roleDepartmentCompanyName: z.string().trim().min(1, "Role department company name is required"),
});

// Update: the controller re-requires both fields, so this is not a
// .partial() of the create schema.
const updateRoleDepartmentCompanySchema = createRoleDepartmentCompanySchema;

module.exports = { createRoleDepartmentCompanySchema, updateRoleDepartmentCompanySchema };
