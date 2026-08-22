const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);
const emailField = z.string().trim().regex(/^\S+@\S+\.\S+$/, "Invalid email format").optional().or(z.literal(""));

// Structural validation only — companyName/createdBy existence checks stay
// in the controller.
const addressSchema = z.object({
  unitNo: z.string().trim().min(1, "unitNo is required"),
  marketName: z.string().trim().min(1, "marketName is required"),
  streetAddress: z.string().trim().min(1, "streetAddress is required"),
  landMark: z.string().trim().optional().nullable(),
  area: z.string().trim().min(1, "area is required"),
  pincode: z.string().trim().regex(/^[0-9]{6}$/, "Invalid pincode format. Must be 6 digits."),
});

const createAccountMasterSchema = z.object({
  companyName: idField,
  partyName: z.string().trim().min(1, "Party name is required"),
  ownerName: z.string().trim().optional().nullable(),
  ownerMobileNo: z.string().trim().optional().nullable(),
  ownerWhatsAppNo: z.string().trim().min(1, "Owner WhatsApp number is required"),
  ownerEmail: emailField,
  contactPerson: z.string().trim().optional().nullable(),
  personMobileNo: z.string().trim().optional().nullable(),
  personWhatsAppNo: z.string().trim().optional().nullable(),
  contactPersonEmail: emailField,
  contactForPayment: z.string().trim().optional().nullable(),
  contactMobileNo: z.string().trim().optional().nullable(),
  contactWhatsAppNo: z.string().trim().optional().nullable(),
  contactForPaymentEmail: emailField,
  GSTNo: z.string().trim().optional().nullable(),
  // Used by the invoicing module (Module 4) to auto-determine CGST/SGST
  // vs IGST by comparing this party's state to the billing company's state.
  state: z.string().trim().optional().nullable(),
  address: addressSchema,
  reasonToVisit: z.string().trim().min(1, "reasonToVisit is required"),
  reference: z.string().trim().optional().nullable(),
  createdBy: idField,
  isRequestMode: z.boolean().optional(),
});

// Update: companyName + reasonToVisit are still required per the
// controller; other fields remain optional (createdBy optional there too).
// `statusApproval` isn't part of the create payload (a party starts
// Pending/Approved based on isRequestMode) but updateAccountMaster reads
// req.body.statusApproval to let an update also change approval status —
// must be modeled here or zod's default key-stripping silently drops it
// and that field becomes permanently un-updatable via this endpoint.
const updateAccountMasterSchema = createAccountMasterSchema
  .omit({ address: true })
  .extend({ address: addressSchema.partial() })
  .partial()
  .extend({
    companyName: idField,
    reasonToVisit: z.string().trim().min(1, "reasonToVisit is required"),
    statusApproval: z.enum(["Pending", "Approved"]).optional(),
  });

module.exports = { createAccountMasterSchema, updateAccountMasterSchema };
