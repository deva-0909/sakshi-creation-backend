const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);

const createWarehouseSchema = z.object({
  warehouseName: z.string().min(1, "Warehouse name is required"),
  warehouseCode: z.string().optional(),
  companyName: idField.optional(),
  address: z.string().optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
});

const updateWarehouseSchema = createWarehouseSchema.partial();

module.exports = { createWarehouseSchema, updateWarehouseSchema };
