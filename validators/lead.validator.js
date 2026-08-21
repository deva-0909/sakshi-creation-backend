const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const timeField = z.string().trim().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format. Use HH:MM in 24-hour format.");
const updateStatusEnum = z.enum(["pending", "completed", "cancelled", "rescheduled"]);

// Structural validation only — company/party/staff existence checks stay
// in the controller.
const createLeadSchema = z.object({
  companyName: idField,
  partyName: idField,
  reason: z.string().trim().min(1, "Reason is required"),
  customReason: z.string().trim().optional().nullable(),
  assignedTo: idField,
  date: z.string().trim().optional().nullable(),
  time: timeField.optional().nullable().or(z.literal("")),
});

// Update: the controller requires callFeedback (non-empty) on every
// update, and status is restricted to a wider enum than create's implicit
// "pending" default. Everything else stays optional, matching the
// controller's partial-patch behavior.
const updateLeadSchema = createLeadSchema.partial().extend({
  status: updateStatusEnum.optional(),
  callFeedback: z.string().trim().min(1, "Call feedback is required for updates"),
  rescheduleDate: z.string().trim().optional().nullable(),
});

module.exports = { createLeadSchema, updateLeadSchema };
