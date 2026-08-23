const { z } = require("zod");

const idField = z.union([z.string(), z.number()]);

const createDeliveryChallanSchema = z.object({
  orderId: idField,
  quantityDelivered: z.union([z.string(), z.number()]).refine(
    (v) => !isNaN(Number(v)) && Number(v) > 0,
    "Quantity delivered must be a positive number"
  ),
  vehicleNumber: z.string().trim().optional(),
  vehicleType: z.string().trim().optional(),
  driverName: z.string().trim().optional(),
  driverContact: z.string().trim().optional(),
  packageCount: z.union([z.string(), z.number()]).optional(),
  packageWeight: z.union([z.string(), z.number()]).optional(),
  deliveryDate: z.string().optional(),
  notes: z.string().optional(),
});

const recordPodSchema = z.object({
  podReceivedBy: z.string().trim().min(1, "Received-by name is required"),
  podDesignation: z.string().trim().optional(),
  podNotes: z.string().optional(),
  podSignatureUrl: z.string().trim().optional(),
});

const cancelDeliveryChallanSchema = z.object({
  remarks: z.string().trim().min(1, "A reason is required to cancel a delivery challan"),
});

module.exports = { createDeliveryChallanSchema, recordPodSchema, cancelDeliveryChallanSchema };
