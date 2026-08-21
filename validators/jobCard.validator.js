const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const numericField = z.union([z.string(), z.number()]).refine(
  (v) => !isNaN(Number(v)),
  "Must be a number"
);

const createJobCardSchema = z.object({
  priority: z.enum(["Low", "Normal", "High", "Urgent"]).optional(),
  dueDate: z.string().optional(),
});

const updateJobCardSchema = z.object({
  priority: z.enum(["Low", "Normal", "High", "Urgent"]).optional(),
  dueDate: z.string().optional(),
  assignedTo: idField.optional(),
  status: z.enum(["Pending", "In Progress", "On Hold", "Completed", "Cancelled"]).optional(),
});

const advanceStageSchema = z.object({
  stage: z.enum(["Designer", "Printer", "Binder", "Booklet Binder", "Delivery"]),
  assignedTo: idField.optional(),
  status: z.enum(["Pending", "In Progress", "Done"]),
  remarks: z.string().optional(),
  wastedSheet: numericField.optional(),
});

const materialUsageSchema = z.object({
  jobCardStageId: idField.optional(),
  material: idField,
  bom: idField.optional(),
  quantityUsed: numericField.refine((v) => Number(v) > 0, "Quantity used must be a positive number"),
  forRole: idField,
  forCompany: idField,
});

module.exports = {
  createJobCardSchema,
  updateJobCardSchema,
  advanceStageSchema,
  materialUsageSchema,
};
