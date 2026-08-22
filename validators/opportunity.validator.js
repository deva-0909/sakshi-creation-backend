const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const numericField = z.union([z.string(), z.number()]).refine((v) => !isNaN(Number(v)), "Must be a number");

// Structural validation only — id-existence checks stay in the
// controller, matching every other validator in this app.
const createOpportunitySchema = z.object({
  companyName: idField,
  prospectName: z.string().min(1, "Prospect/company name is required"),
  contactPerson: z.string().optional(),
  // Required (not just optional) because a Won conversion writes this
  // straight into parties.owner_whatsapp_no, which is NOT NULL — asking
  // for it up front means the conversion RPC can never fail on a missing
  // contact number.
  contactPhone: z.string().min(1, "Contact phone is required"),
  contactEmail: z.string().email().optional().or(z.literal("")),
  estimatedValue: numericField.refine((v) => Number(v) >= 0, "Must be zero or positive").optional(),
  source: z.string().optional(),
  assignedTo: idField.optional(),
  notes: z.string().optional(),
});

// Only New/Contacted/Qualified/Proposal Sent opportunities can be edited
// (enforced in the controller) — the shape itself is the same fields, all
// optional.
const updateOpportunitySchema = createOpportunitySchema.partial();

const loseOpportunitySchema = z.object({
  lostReason: z.string().min(1, "A reason is required to mark an opportunity Lost"),
});

const addActivitySchema = z.object({
  type: z.enum(["call", "meeting", "email", "note"]).optional(),
  notes: z.string().min(1, "Notes are required"),
  activityDate: z.string().optional(),
});

module.exports = {
  createOpportunitySchema,
  updateOpportunitySchema,
  loseOpportunitySchema,
  addActivitySchema,
};
