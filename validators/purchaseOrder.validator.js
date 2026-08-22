const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const numericField = z.union([z.string(), z.number()]).refine((v) => !isNaN(Number(v)), "Must be a number");

const poItemSchema = z.object({
  materialId: idField,
  quantityOrdered: numericField.refine((v) => Number(v) > 0, "quantityOrdered must be a positive number"),
  rate: numericField.refine((v) => Number(v) > 0, "rate must be a positive number"),
});

// Manual PO creation (not spawned from a won RFQ) -- still supported, since
// not every purchase needs a multi-vendor RFQ round first.
const createPurchaseOrderSchema = z.object({
  vendorId: idField,
  companyName: idField,
  expectedDate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(poItemSchema).min(1, "At least one material line is required"),
});

const updatePurchaseOrderSchema = z.object({
  expectedDate: z.string().optional(),
  notes: z.string().optional(),
});

module.exports = {
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
};
