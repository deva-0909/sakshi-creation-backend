const { z } = require("zod");

const numericField = z.union([z.string(), z.number()]).refine((v) => !isNaN(Number(v)), "Must be a number");
const nonNegative = (label) => numericField.refine((v) => Number(v) >= 0, `${label} cannot be negative`).optional();

// No wage/rate data exists anywhere in the system (see the design plan) --
// all 8 cost buckets are recorded manually per job card rather than
// derived from a rate table. Module 14 extended this from 2 buckets
// (labor/overhead) to all 8 the scope doc asks for, per the user's
// explicit choice of "all 8" over the smaller 7-bucket option offered.
const upsertLaborCostSchema = z.object({
  laborCost: nonNegative("laborCost"),
  overheadCost: nonNegative("overheadCost"),
  printingCost: nonNegative("printingCost"),
  bindingCost: nonNegative("bindingCost"),
  finishingCost: nonNegative("finishingCost"),
  outsourcingCost: nonNegative("outsourcingCost"),
  deliveryCost: nonNegative("deliveryCost"),
  notes: z.string().optional(),
});

module.exports = { upsertLaborCostSchema };
