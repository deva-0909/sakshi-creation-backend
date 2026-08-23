const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const CATEGORIES = ["printer", "binder", "booklet", "factory", "godown"];

const createStockTransferSchema = z.object({
  materialId: idField,
  quantity: z.union([z.string(), z.number()]).refine((v) => Number(v) > 0, "quantity must be greater than 0"),
  category: z.enum(CATEGORIES),
  fromWarehouse: idField.optional(),
  toWarehouse: idField,
  companyName: idField,
  forRole: idField,
  forCompany: idField,
  transferDate: z.string().optional(),
  notes: z.string().optional(),
});

const createStockAdjustmentSchema = z.object({
  materialId: idField,
  warehouse: idField.optional(),
  category: z.enum(CATEGORIES),
  adjustmentType: z.enum(["Increase", "Decrease"]),
  quantity: z.union([z.string(), z.number()]).refine((v) => Number(v) > 0, "quantity must be greater than 0"),
  reason: z.string().min(1, "Reason is required"),
  companyName: idField,
  forRole: idField,
  forCompany: idField,
  adjustmentDate: z.string().optional(),
});

const createStockReservationSchema = z.object({
  materialId: idField,
  warehouse: idField.optional(),
  category: z.enum(CATEGORIES).optional(),
  quantity: z.union([z.string(), z.number()]).refine((v) => Number(v) > 0, "quantity must be greater than 0"),
  reservedFor: z.string().optional(),
  notes: z.string().optional(),
  companyName: idField,
  forRole: idField,
  forCompany: idField,
});

const updateStockReservationStatusSchema = z.object({
  status: z.enum(["Consumed", "Cancelled"]),
});

module.exports = {
  createStockTransferSchema,
  createStockAdjustmentSchema,
  createStockReservationSchema,
  updateStockReservationStatusSchema,
};
