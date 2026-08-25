const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);

const createComplaintSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  description: z.string().optional(),
  priority: z.enum(["Low", "Normal", "High", "Urgent"]).optional(),
  party: idField.optional(),
  order: idField.optional(),
  assignedTo: idField.optional(),
  companyName: idField.optional(),
});

const updateComplaintSchema = z.object({
  subject: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.enum(["Low", "Normal", "High", "Urgent"]).optional(),
  status: z.enum(["Open", "In Progress", "Resolved", "Closed"]).optional(),
  party: idField.optional(),
  order: idField.optional(),
  assignedTo: idField.optional(),
  resolutionNotes: z.string().optional(),
  companyName: idField.optional(),
});

module.exports = { createComplaintSchema, updateComplaintSchema };
