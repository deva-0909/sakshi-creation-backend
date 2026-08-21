const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);

// Structural validation only — company-existence check stays in the
// controller.
const createVendorSchema = z.object({
  companyName: idField,
  name: z.string().trim().min(1, "Vendor name is required"),
  contactNumber: z.string().trim().min(1, "Contact number is required"),
  whatsappNumber: z.string().trim().min(1, "WhatsApp number is required"),
  gst: z.string().optional(),
  address: z.string().trim().min(1, "Address is required"),
});

const updateVendorSchema = createVendorSchema.partial();

module.exports = { createVendorSchema, updateVendorSchema };
