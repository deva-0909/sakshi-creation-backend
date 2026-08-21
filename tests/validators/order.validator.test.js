const { createOrderSchema, updateOrderSchema } = require("../../validators/order.validator");

// Patch 11 regression: updateOrderSchema used to be a bare
// createOrderSchema.partial(), which — per zod's default "strip unknown
// keys" behavior — silently dropped every field the update controller
// reads that isn't part of createOrderSchema (designer/printer/binder
// assignment, status, wasted-sheet counts, printingrate/gsm/rateBook/
// totalAmount/ratePerUnit/bindergst, delivery info, etc). That made
// PATCH /orders/update/:id a near-total no-op for the multi-stage order
// workflow. .passthrough() fixed it; these tests pin that behavior so a
// future refactor can't reintroduce the strip.
describe("updateOrderSchema", () => {
  it("passes through fields the controller reads that aren't modeled in the schema", () => {
    const result = updateOrderSchema.safeParse({
      status: "printing",
      designer: "123e4567-e89b-12d3-a456-426614174000",
      printer: "123e4567-e89b-12d3-a456-426614174001",
      wastedSheets: 12,
      deliveryAddress: "123 Main St",
    });
    expect(result.success).toBe(true);
    expect(result.data.status).toBe("printing");
    expect(result.data.designer).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(result.data.wastedSheets).toBe(12);
    expect(result.data.deliveryAddress).toBe("123 Main St");
  });

  it("still type-checks the numeric fields it does model", () => {
    const result = updateOrderSchema.safeParse({ printingrate: "not-a-number" });
    expect(result.success).toBe(false);
  });

  it("accepts numeric fields as numbers or numeric strings", () => {
    expect(updateOrderSchema.safeParse({ gsm: 130 }).success).toBe(true);
    expect(updateOrderSchema.safeParse({ gsm: "130" }).success).toBe(true);
  });

  it("treats an empty string on a numeric field as 'clear the field' (null)", () => {
    const result = updateOrderSchema.safeParse({ totalAmount: "" });
    expect(result.success).toBe(true);
    expect(result.data.totalAmount).toBeNull();
  });

  it("validates bindergst as numeric now that the column is numeric", () => {
    expect(updateOrderSchema.safeParse({ bindergst: "18" }).success).toBe(true);
    expect(updateOrderSchema.safeParse({ bindergst: "abc" }).success).toBe(false);
  });

  it("allows a partial payload with no fields at all", () => {
    expect(updateOrderSchema.safeParse({}).success).toBe(true);
  });
});

describe("createOrderSchema", () => {
  const validBase = {
    companyName: "123e4567-e89b-12d3-a456-426614174000",
    party: "123e4567-e89b-12d3-a456-426614174001",
    productItem: "123e4567-e89b-12d3-a456-426614174002",
    qty: 10,
  };

  it("accepts a minimal valid order payload", () => {
    expect(createOrderSchema.safeParse(validBase).success).toBe(true);
  });

  it("rejects a missing required field", () => {
    const { qty, ...withoutQty } = validBase;
    expect(createOrderSchema.safeParse(withoutQty).success).toBe(false);
  });

  it("rejects a zero or negative quantity", () => {
    expect(createOrderSchema.safeParse({ ...validBase, qty: 0 }).success).toBe(false);
    expect(createOrderSchema.safeParse({ ...validBase, qty: -5 }).success).toBe(false);
  });

  it("rejects an invalid rateType enum value", () => {
    expect(createOrderSchema.safeParse({ ...validBase, rateType: "bogus" }).success).toBe(false);
  });
});
