const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);

// Structural validation only, same convention as every other validator in
// this app -- id-existence checks stay in the controller.
const createDyePunchSchema = z.object({
  dyePunchNumber: z.string().min(1, "Dye/Punch number is required"),
  type: z.string().optional(),
  party: idField.optional(),
  size: z.string().optional(),
  ply: z.string().optional(),
  sheetSize: z.string().optional(),
  boxSize: z.string().optional(),
  // QP box-manufacturing Figma audit (2026-08-25): the Dye/Punch master
  // screen also shows Kantan + Kantan type alongside Ply/Sheet Size/Box
  // Size, which already existed here.
  kantan: z.string().optional(),
  kantanType: z.string().optional(),
  remarks: z.string().optional(),
  companyName: idField.optional(),
});

const updateDyePunchSchema = createDyePunchSchema.partial();

module.exports = { createDyePunchSchema, updateDyePunchSchema };
