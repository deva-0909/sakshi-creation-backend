const { z } = require("zod");

// Structural validation only — the controller still owns business rules
// (aadhar uniqueness, role/company existence, aadhar regex, etc). This
// schema exists to reject malformed payloads (wrong types, missing
// required fields) before they reach the controller/DB layer.
const createStaffSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
  mobileNo: z.string().trim().min(1, "Mobile number is required"),
  whatsappNo: z.string().trim().min(1, "WhatsApp number is required"),
  address: z.string().trim().min(1, "Address is required"),
  aadharNo: z.string().trim().min(1, "Aadhar number is required"),
  joiningDate: z.string().trim().min(1, "Joining date is required"),
  birthDay: z.string().trim().optional().nullable(),
  password: z.string().min(1, "Password is required"),
  role: z.union([z.string(), z.number()]),
  companyName: z.union([z.string(), z.number()]),
  aadharFiles: z.array(z.any()).min(1, "At least one Aadhar file is required"),
  addressFiles: z.array(z.any()).optional(),
});

// Update payloads are partial — any subset of the above fields, still
// type-checked when present.
const updateStaffSchema = createStaffSchema.partial();

module.exports = { createStaffSchema, updateStaffSchema };
