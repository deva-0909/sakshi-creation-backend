const { z } = require("zod");

const createDesignationSchema = z.object({
  designationName: z.string().min(1, "Designation name is required"),
  status: z.enum(["Active", "Inactive"]).optional(),
});

const updateDesignationSchema = createDesignationSchema.partial();

module.exports = { createDesignationSchema, updateDesignationSchema };
