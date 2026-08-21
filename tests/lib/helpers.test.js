const { isValidId, withMongoId, maskAadhar } = require("../../lib/helpers");

describe("isValidId", () => {
  it("accepts a well-formed UUID", () => {
    expect(isValidId("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
  });

  it("accepts a UUID regardless of case", () => {
    expect(isValidId("123E4567-E89B-12D3-A456-426614174000")).toBe(true);
  });

  it("rejects non-UUID strings", () => {
    expect(isValidId("not-a-uuid")).toBe(false);
    expect(isValidId("12345")).toBe(false);
    expect(isValidId("")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidId(undefined)).toBe(false);
    expect(isValidId(null)).toBe(false);
    expect(isValidId(123)).toBe(false);
    expect(isValidId({})).toBe(false);
  });
});

describe("withMongoId", () => {
  it("adds a string _id alias mirroring id", () => {
    const result = withMongoId({ id: "abc123", name: "Test" });
    expect(result._id).toBe("abc123");
    expect(result.id).toBe("abc123");
    expect(result.name).toBe("Test");
  });

  it("recurses into nested relation objects", () => {
    const result = withMongoId({
      id: "order-1",
      party: { id: "party-1", partyName: "Acme" },
    });
    expect(result._id).toBe("order-1");
    expect(result.party._id).toBe("party-1");
  });

  it("recurses into arrays of rows", () => {
    const result = withMongoId([{ id: "a" }, { id: "b" }]);
    expect(result).toEqual([
      { id: "a", _id: "a" },
      { id: "b", _id: "b" },
    ]);
  });

  it("passes through null/non-object input unchanged", () => {
    expect(withMongoId(null)).toBeNull();
    expect(withMongoId(undefined)).toBeUndefined();
  });

  it("leaves rows without an id untouched (no _id added)", () => {
    const result = withMongoId({ name: "no id here" });
    expect(result._id).toBeUndefined();
  });
});

describe("maskAadhar", () => {
  it("keeps only the last 4 digits visible", () => {
    expect(maskAadhar("123456789012")).toBe("XXXX-XXXX-9012");
  });

  it("strips non-digit formatting before masking", () => {
    expect(maskAadhar("1234-5678-9012")).toBe("XXXX-XXXX-9012");
  });

  it("falls back to a fully masked value when too short to mask meaningfully", () => {
    expect(maskAadhar("12")).toBe("XXXX-XXXX-XXXX");
  });

  it("passes through non-string/empty input unchanged", () => {
    expect(maskAadhar(null)).toBeNull();
    expect(maskAadhar(undefined)).toBeUndefined();
    expect(maskAadhar("")).toBe("");
  });
});
