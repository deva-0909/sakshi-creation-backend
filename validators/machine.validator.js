const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);

const createMachineSchema = z.object({
  machineName: z.string().min(1, "Machine name is required"),
  machineCode: z.string().min(1, "Machine code is required"),
  category: z.enum(["Printer", "Binder", "Booklet Binder"]),
  companyName: idField,
  capacity: z.string().optional(),
  status: z.enum(["Active", "Under Maintenance", "Inactive"]).optional(),
  purchaseDate: z.string().optional(),
  notes: z.string().optional(),
});

// Structural validation only, same convention as every other validator in
// this app -- id-existence checks stay in the controller.
const updateMachineSchema = createMachineSchema.partial();

module.exports = { createMachineSchema, updateMachineSchema };
