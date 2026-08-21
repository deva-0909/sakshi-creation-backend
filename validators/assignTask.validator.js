const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const timeField = z.string().trim().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format. Use HH:MM (24-hour format)");
const statusEnum = z.enum(["Pending", "Rescheduled", "Completed", "Cancelled"]);

// Structural validation only — party/company/staff existence checks stay
// in the controller.
const createAssignTaskSchema = z.object({
  companyName: idField,
  partyName: idField,
  date: z.string().trim().min(1, "Date is required"),
  time: z.string().trim().optional().nullable(),
  reasonForVisit: z.string().trim().min(1, "Reason for visit is required"),
  assignTo: idField,
  remarks: z.string().trim().optional(),
  status: statusEnum.optional(),
  visitDate: z.string().trim().optional().nullable(),
  visitTime: z.string().trim().optional().nullable(),
  feedback: z.string().trim().optional().nullable(),
  isRescheduledTask: z.boolean().optional(),
  originalTaskId: idField.optional().nullable(),
});

// Update: every field is optional (the controller only patches whatever is
// present), but time/visitTime and status keep the same structural rules
// the controller already enforces.
const updateAssignTaskSchema = createAssignTaskSchema.partial().extend({
  time: timeField.optional().nullable(),
  visitTime: timeField.optional().nullable().or(z.literal("")),
  status: statusEnum.optional(),
  rescheduleDate: z.string().trim().optional().nullable(),
});

module.exports = { createAssignTaskSchema, updateAssignTaskSchema };
