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
    // Patch 112: "Production" added for Quality Packaging's simplified,
    // single-stage job card (box/carton manufacturing has no real
    // Printer/Binder/Booklet Binder/Factory/Godown pipeline -- that was a
    // mistaken copy of Sakshi Creation's book-production model). Factory/
    // Godown/Printer/Binder/Booklet Binder stay in the enum only so
    // historical stage-history rows created before this patch still parse.
    // The controller enforces which stages are actually valid for a given
    // job card's company; this enum is just the full superset across both
    // companies' pipelines, past and present.
    stage: z.enum(["Designer", "Printer", "Binder", "Booklet Binder", "QC", "Delivery", "Factory", "Godown", "Production"]),
    assignedTo: idField.optional(),
    // Patch 112: Sakshi Creation's advance-stage call still sends one of the
    // 3 per-stage statuses (Pending/In Progress/Done). Quality Packaging's
    // simplified single-panel form instead sends one of job_cards_status_
    // check's own values (Pending/In Progress/On Hold/Completed -- "Pending"
    // and "On Hold" read as "Order" and "Hold" in the UI); the controller
    // interprets this field differently per company rather than the schema
    // needing to know which company sent it.
    status: z.enum(["Pending", "In Progress", "Done", "On Hold", "Completed"]),
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
    // QP box-manufacturing Figma audit (2026-08-25): the Order-In screen's
    // expandable Factory checklist -- only meaningful when stage ===
    // "Factory" (same convention as the QC fields above). No formula backs
    // kantan/kantanDeckal in the Figma file itself, so these are plain
    // free-text fields, matching what the design shows.
    unitNumber: numericField.optional(),
    pasteingStatus: z.string().optional(),
    piningStatus: z.string().optional(),
    rsFor: z.string().optional(),
    kantan: z.string().optional(),
    kantanDeckal: z.string().optional(),
    factoryDeliveryDate: z.string().optional(),
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
