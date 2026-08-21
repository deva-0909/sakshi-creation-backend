const { z } = require("zod");

// Structural validation only — the duplicate-name check stays in the
// controller.
const createProductItemSchema = z.object({
  itemName: z.string().trim().min(1, "Item name is required"),
});

// Update: the controller re-requires itemName, so this is not a
// .partial() of the create schema.
const updateProductItemSchema = createProductItemSchema;

module.exports = { createProductItemSchema, updateProductItemSchema };
