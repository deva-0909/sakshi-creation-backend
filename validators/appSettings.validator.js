const { z } = require("zod");

const updateSettingSchema = z.object({
  value: z.union([z.string(), z.number(), z.null()]).optional(),
});

const updateSettingsBulkSchema = z.object({
  settings: z.record(z.union([z.string(), z.number(), z.null()])),
});

module.exports = { updateSettingSchema, updateSettingsBulkSchema };
