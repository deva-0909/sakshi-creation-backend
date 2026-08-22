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

const DEFECT_CATEGORIES = ["Print Misalignment", "Binding Defect", "Paper Damage", "Color Mismatch", "Other"];

const advanceStageSchema = z
  .object({
    stage: z.enum(["Designer", "Printer", "Binder", "Booklet Binder", "QC", "Delivery"]),
    assignedTo: idField.optional(),
    status: z.enum(["Pending", "In Progress", "Done"]),
    remarks: z.string().optional(),
    // Real per-stage quantities (Module 8) -- distinct from each other so
    // "how much actually came out right" is a real number, not implied.
    completedQty: numericField.optional(),
    rejectedQty: numericField.optional(),
    reworkQty: numericField.optional(),
    // Only meaningful for Printer/Binder/Booklet Binder -- the 3 stages that
    // run on physical equipment (see machine.validator.js's category enum).
    machine: idField.optional(),
    // QC fields (Module 8) -- only meaningful when stage === "QC". Advisory
    // only per the user's decision: a Failed result is recorded but does
    // not block the job card from moving on to Delivery.
    qcResult: z.enum(["Passed", "Failed"]).optional(),
    defectCategory: z.enum(DEFECT_CATEGORIES).optional(),
    defectReason: z.string().optional(),
    // Wastage (Module 8): wastedSheet keeps its name for backward
    // compatibility with existing rows/reports, but recording it now
    // requires naming which material was actually wasted (plus the same
    // Role -> Staff picker Record Material Usage already uses) so it can
    // write a real `wastage` inventory movement, not just a screen number.
    wastedSheet: numericField.optional(),
    wastageReason: z.string().optional(),
    wastageMaterial: idField.optional(),
    wastageForRole: idField.optional(),
    wastageForCompany: idField.optional(),
  })
  .refine((data) => data.wastedSheet === undefined || Number(data.wastedSheet) <= 0 || (data.wastageMaterial && data.wastageForRole && data.wastageForCompany), {
    message: "Recording wastage requires wastageMaterial, wastageForRole, and wastageForCompany",
    path: ["wastageMaterial"],
  });

const materialUsageSchema = z.object({
  jobCardStageId: idField.optional(),
  material: idField,
  bom: idField.optional(),
  quantityUsed: numericField.refine((v) => Number(v) > 0, "Quantity used must be a positive number"),
  forRole: idField,
  forCompany: idField,
});

const createReworkSchema = z.object({
  jobCardStageId: idField.optional(),
  reason: z.string().min(1, "Reason is required"),
  defectCategory: z.enum(DEFECT_CATEGORIES).optional(),
  quantity: numericField.optional(),
  responsibleDepartment: z.string().optional(),
  responsibleStaff: idField.optional(),
  additionalMaterialNotes: z.string().optional(),
  cost: numericField.optional(),
});

const rejectReworkSchema = z.object({
  remarks: z.string().min(1, "A reason is required to send a rework record back"),
});

module.exports = {
  createJobCardSchema,
  updateJobCardSchema,
  advanceStageSchema,
  materialUsageSchema,
  createReworkSchema,
  rejectReworkSchema,
  DEFECT_CATEGORIES,
};
