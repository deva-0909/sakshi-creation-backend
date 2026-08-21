// §38 regression coverage: sanitizeFolder/isGeneratedFilename are the
// guards that stopped an unvalidated folder/filename from reaching a
// Supabase Storage path (see lib/storage.js's comment for the original
// finding). These tests pin their allow/deny behavior so a future change
// can't silently widen what's accepted.
jest.mock("../../lib/supabaseClient", () => ({
  storage: { from: jest.fn() },
}));

const { sanitizeFolder, isGeneratedFilename } = require("../../lib/storage");

describe("sanitizeFolder", () => {
  it("accepts a plain safe folder name", () => {
    expect(sanitizeFolder("aadhar")).toBe("aadhar");
    expect(sanitizeFolder("staff-files")).toBe("staff-files");
    expect(sanitizeFolder("order_123")).toBe("order_123");
  });

  it("falls back to 'general' for path traversal attempts", () => {
    expect(sanitizeFolder("../../etc")).toBe("general");
    expect(sanitizeFolder("../secrets")).toBe("general");
  });

  it("falls back to 'general' for a folder containing a path separator", () => {
    expect(sanitizeFolder("a/b")).toBe("general");
    expect(sanitizeFolder("a/../b")).toBe("general");
  });

  it("falls back to 'general' for empty/missing input", () => {
    expect(sanitizeFolder("")).toBe("general");
    expect(sanitizeFolder(null)).toBe("general");
    expect(sanitizeFolder(undefined)).toBe("general");
  });

  it("falls back to 'general' for a folder over 64 characters", () => {
    expect(sanitizeFolder("a".repeat(65))).toBe("general");
  });
});

describe("isGeneratedFilename", () => {
  it("accepts the exact pattern uploadBuffer produces", () => {
    expect(isGeneratedFilename("file-1699999999999-123456789.pdf")).toBe(true);
    expect(isGeneratedFilename("file-1-1.png")).toBe(true);
  });

  it("rejects a filename that doesn't match the generated pattern", () => {
    expect(isGeneratedFilename("../../etc/passwd")).toBe(false);
    expect(isGeneratedFilename("not-generated.pdf")).toBe(false);
    expect(isGeneratedFilename("file-123.pdf")).toBe(false); // missing second number
  });

  it("rejects empty/missing input", () => {
    expect(isGeneratedFilename("")).toBe(false);
    expect(isGeneratedFilename(null)).toBe(false);
    expect(isGeneratedFilename(undefined)).toBe(false);
  });
});
