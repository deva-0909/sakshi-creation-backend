const { createVendorSchema, updateVendorSchema } = require("../../validators/vendor.validator");

describe("createVendorSchema", () => {
  const valid = {
    companyName: "123e4567-e89b-12d3-a456-426614174000",
    name: "Acme Paper Co",
    contactNumber: "9876543210",
    whatsappNumber: "9876543210",
    address: "1 Industrial Rd",
  };

  it("accepts a fully valid payload", () => {
    expect(createVendorSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a blank required string field", () => {
    expect(createVendorSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
    expect(createVendorSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { address, ...withoutAddress } = valid;
    expect(createVendorSchema.safeParse(withoutAddress).success).toBe(false);
  });

  it("treats gst as optional", () => {
    expect(createVendorSchema.safeParse(valid).success).toBe(true);
    expect(createVendorSchema.safeParse({ ...valid, gst: "22AAAAA0000A1Z5" }).success).toBe(true);
  });
});

describe("updateVendorSchema", () => {
  it("allows an empty partial update", () => {
    expect(updateVendorSchema.safeParse({}).success).toBe(true);
  });

  it("still rejects a blank name when name is provided", () => {
    expect(updateVendorSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("accepts a single-field update", () => {
    expect(updateVendorSchema.safeParse({ address: "New Address" }).success).toBe(true);
  });
});
