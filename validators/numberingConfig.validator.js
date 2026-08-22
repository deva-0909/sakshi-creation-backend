const { z } = require("zod");

// doc_type and sequence_offset are deliberately not modeled here -- see the
// comment in numberingConfig.controller.js for why they're immutable.
const updateNumberingConfigSchema = z.object({
  prefix: z.string().nullable().optional(),
  separator: z.string().min(1).optional(),
  includeInitials: z.boolean().optional(),
  paddingWidth: z.union([z.number(), z.null()]).optional(),
});

module.exports = { updateNumberingConfigSchema };
