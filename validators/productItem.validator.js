const { z } = require("zod");

// Structural validation only — the duplicate-name check stays in the
// controller.
const createProductItemSchema = z.object({
  itemName: z.string().trim().min(1, "Item name is required"),
  status: z.string().optional(),
});

// Module 10: the controller now also accepts a status-only update (e.g.
// deactivating an item without renaming it), so itemName is optional here.
const updateProductItemSchema = z.object({
  itemName: z.string().trim().min(1).optional(),
  status: z.string().optional(),
});

module.exports = { createProductItemSchema, updateProductItemSchema };
