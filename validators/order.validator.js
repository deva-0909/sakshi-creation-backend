const { z } = require("zod");

// Structural validation only — id-existence, rate/type business rules,
// etc. remain in the controller. This catches malformed payloads early.
const idField = z.union([z.string(), z.number()]);
// gsm/printingrate/rateBook/totalAmount/ratePerUnit are numeric columns
// in the DB (orders.gsm etc.) but only ever arrive on the update path
// (see updateOrderSchema below), so this shape isn't part of
// createOrderSchema. A non-numeric value here would otherwise reach
// Supabase as a raw insert/update and come back as an opaque Postgres
// error instead of a clean 400. An empty string is treated as "clear
// the field" (mapped to null) rather than rejected, since a numeric
// Postgres column can't store "".
const numericField = z.preprocess(
  (v) => (v === "" ? null : v),
  z.union([z.string(), z.number(), z.null()]).refine(
    (v) => v === null || !isNaN(Number(v)),
    "Must be a number"
  )
);

const createOrderSchema = z.object({
  companyName: idField,
  party: idField,
  productItem: idField,
  qty: z.union([z.string(), z.number()]).refine(
    (v) => !isNaN(Number(v)) && Number(v) > 0,
    "Quantity must be a positive number"
  ),
  remarks: z.string().optional(),
  filePaths: z.any().optional(),
  createdBy: idField.optional(),
  isGst: z.boolean().optional(),
  size: z.string().optional(),
  rate: z.union([z.string(), z.number()]).optional(),
  rateType: z.enum(["old", "new"]).optional(),
  isLamination: z.boolean().optional(),
  laminationType: z.enum(["Matte", "Gloss"]).optional(),
  // Module 12: Sales Order commercial fields.
  customerPoNumber: z.string().trim().optional(),
  priority: z.enum(["Low", "Normal", "High", "Urgent"]).optional(),
});

// Update payloads are partial — any subset of the above fields, still
// type-checked when present.
//
// IMPORTANT: `updateOrder` (controllers/order.controller.js) reads 50+
// fields off req.body beyond what createOrderSchema models — designer/
// printer/binder/booklet-binder assignment and status, wasted-sheet
// counts, printingrate/gsm/rateBook/totalAmount/ratePerUnit (bindergst
// is now explicitly modeled too, see below), paper/file fields,
// delivery info, and more, as each production stage
// PATCHes only the fields relevant to it. zod object schemas strip
// unrecognized keys by default, so a bare `.partial()` here silently
// dropped every one of those fields before the controller ever saw
// them — the entire multi-stage order workflow (status changes, stage
// assignment, financial fields, delivery) was being silently no-op'd
// by every PUT /orders/update/:id call. `.passthrough()` keeps
// validating the fields modeled above while letting the rest of the
// payload through unchanged, matching what the controller actually
// consumes; the controller has its own inline checks (printer/binder/
// booklet-binder wasted-sheet non-negativity, rate, rateType,
// isLamination) for the higher-risk fields immediately after this.
const updateOrderSchema = createOrderSchema.partial().extend({
  printingrate: numericField.optional(),
  gsm: numericField.optional(),
  rateBook: numericField.optional(),
  totalAmount: numericField.optional(),
  ratePerUnit: numericField.optional(),
  bindergst: numericField.optional(),
}).passthrough();

module.exports = { createOrderSchema, updateOrderSchema };
