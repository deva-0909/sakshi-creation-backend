const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);

// Structural validation only, same convention as every other validator in
// this app -- id-existence checks stay in the controller.
const createGodownBoxReceiptSchema = z.object({
  boxLabel: z.string().min(1, "Box/Cartoon label is required"),
  boxType: z.string().optional(),
  size: z.string().optional(),
  qty: z.union([z.string(), z.number()]).optional(),
  gsm: z.union([z.string(), z.number()]).optional(),
  dateOfOrder: z.string().optional(),
  order: idField.optional(),
  receivedDate: z.string().optional(),
  receivedPcs: z.union([z.string(), z.number()]).optional(),
  vendor: idField.optional(),
  type: z.enum(["inward", "outward"]).optional(),
  companyName: idField.optional(),
});

const updateGodownBoxReceiptSchema = createGodownBoxReceiptSchema.partial();

module.exports = { createGodownBoxReceiptSchema, updateGodownBoxReceiptSchema };
