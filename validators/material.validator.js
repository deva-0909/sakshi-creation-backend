const { z } = require("zod");

// Structural validation only — the duplicate-material check stays in the
// controller. materialGSM is accepted as string or number since the
// controller stores it as-is without coercion.
const idField = z.union([z.string(), z.number()]);

const createMaterialSchema = z.object({
  materialName: z.string().trim().min(1, "Material name is required"),
  materialSize: z.string().trim().min(1, "Material size is required"),
  materialGSM: z.union([z.string().trim().min(1, "Material GSM is required"), z.number()]),
  // Module 10: optional UOM link + generalized activation toggle.
  uom: idField.optional(),
  status: z.string().optional(),
});

const updateMaterialSchema = createMaterialSchema.partial();

module.exports = { createMaterialSchema, updateMaterialSchema };
