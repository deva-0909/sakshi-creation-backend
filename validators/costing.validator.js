const { z } = require("zod");

const numericField = z.union([z.string(), z.number()]).refine((v) => !isNaN(Number(v)), "Must be a number");

// No wage/rate data exists anywhere in the system (see the design plan) --
// labor and overhead are recorded manually per job card rather than
// derived from a rate table.
const upsertLaborCostSchema = z.object({
  laborCost: numericField.refine((v) => Number(v) >= 0, "laborCost cannot be negative").optional(),
  overheadCost: numericField.refine((v) => Number(v) >= 0, "overheadCost cannot be negative").optional(),
  notes: z.string().optional(),
});

module.exports = { upsertLaborCostSchema };
