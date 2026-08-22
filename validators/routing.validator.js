const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);

const createProcessStageSchema = z.object({
  stageName: z.string().min(1, "Stage name is required"),
  stageOrder: z.number().optional(),
  description: z.string().optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
});
const updateProcessStageSchema = createProcessStageSchema.partial();

const createRoutingTemplateSchema = z.object({
  templateName: z.string().min(1, "Template name is required"),
  productItemId: idField.optional(),
  isDefault: z.boolean().optional(),
  stageIds: z.array(idField).min(1, "At least one process stage is required"),
});
const updateRoutingTemplateSchema = z.object({
  templateName: z.string().optional(),
  productItemId: idField.optional(),
  isDefault: z.boolean().optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
  stageIds: z.array(idField).optional(),
});

module.exports = { createProcessStageSchema, updateProcessStageSchema, createRoutingTemplateSchema, updateRoutingTemplateSchema };
