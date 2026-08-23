const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const numericField = z.union([z.string(), z.number()]).refine((v) => !isNaN(Number(v)), "Must be a number");

const requisitionItemSchema = z.object({
  materialId: idField,
  quantityRequired: numericField.refine((v) => Number(v) > 0, "quantityRequired must be a positive number"),
  notes: z.string().optional(),
});

const createPurchaseRequisitionSchema = z.object({
  companyName: idField,
  notes: z.string().optional(),
  items: z.array(requisitionItemSchema).min(1, "At least one material line is required"),
});

const rejectPurchaseRequisitionSchema = z.object({
  remarks: z.string().min(1, "remarks is required"),
});

const cancelPurchaseRequisitionSchema = z.object({
  remarks: z.string().min(1, "remarks is required"),
});

const convertToRfqSchema = z.object({
  vendorIds: z.array(idField).min(1, "At least one vendor must be invited"),
  notes: z.string().optional(),
});

const convertToPoSchema = z.object({
  vendorId: idField,
  expectedDate: z.string().optional(),
  notes: z.string().optional(),
  // rate per requisition item, keyed by purchaseRequisitionItemId -- the
  // requisition itself carries no vendor/rate, only quantity-required.
  items: z
    .array(
      z.object({
        requisitionItemId: idField,
        rate: numericField.refine((v) => Number(v) > 0, "rate must be a positive number"),
      })
    )
    .min(1, "At least one item rate is required"),
});

module.exports = {
  createPurchaseRequisitionSchema,
  rejectPurchaseRequisitionSchema,
  cancelPurchaseRequisitionSchema,
  convertToRfqSchema,
  convertToPoSchema,
};
