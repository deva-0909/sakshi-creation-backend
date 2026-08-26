// Multi-role audit fix (Finding 4): authorizePermission/authorizeView now
// resolve permissions live against the `roles` table on every request
// instead of trusting the JWT's roleData.permissions snapshot -- see
// middleware/authorize.js's resolvePermissions() for the full rationale.
// That makes the middleware async, so every call below is awaited; the
// supabase client is mocked so these stay fast, isolated unit tests with no
// real network/DB dependency.
const mockMaybeSingle = jest.fn();
const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ select: mockSelect }));

jest.mock("../../lib/supabaseClient", () => ({
  from: (...args) => mockFrom(...args),
}));

const { authorizePermission, authorizeView } = require("../../middleware/authorize");

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// Older tokens (or tests exercising the JWT-fallback path) have no
// roleData.id -- resolvePermissions() skips the live lookup entirely in
// that case and falls straight back to the snapshot, so these behave
// exactly like the pre-Finding-4 synchronous tests, just awaited.
function reqWithSnapshotOnly(permissions) {
  return { user: { roleData: { permissions } } };
}

// A token that DOES carry a role id -- resolvePermissions() will hit the
// (mocked) `roles` table for these.
function reqWithRoleId(roleId, snapshotPermissions) {
  return { user: { id: "staff-1", roleData: { id: roleId, permissions: snapshotPermissions } } };
}

beforeEach(() => {
  mockFrom.mockClear();
  mockSelect.mockClear();
  mockEq.mockClear();
  mockMaybeSingle.mockReset();
});

describe("authorizePermission", () => {
  it("calls next() when the role has the required permission (JWT-snapshot fallback path, no role id)", async () => {
    const req = reqWithSnapshotOnly({ purchase: { create: true } });
    const res = mockRes();
    const next = jest.fn();

    await authorizePermission("purchase", "create")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns 403 when the role lacks the required action for the module", async () => {
    const req = reqWithSnapshotOnly({ purchase: { view_global: true } });
    const res = mockRes();
    const next = jest.fn();

    await authorizePermission("purchase", "create")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 403 when the module key isn't present in permissions at all", async () => {
    const req = reqWithSnapshotOnly({ purchase: { create: true } });
    const res = mockRes();
    const next = jest.fn();

    await authorizePermission("vendor", "create")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 403 when no permissions object exists on the token at all", async () => {
    const req = { user: {} };
    const res = mockRes();
    const next = jest.fn();

    await authorizePermission("purchase", "create")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("falls back through an array of module keys, taking the first that grants the action", async () => {
    const req = reqWithSnapshotOnly({ setup: { create: true } });
    const res = mockRes();
    const next = jest.fn();

    await authorizePermission(["setup.company-name", "setup"], "create")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("denies when none of the fallback keys grant the action", async () => {
    const req = reqWithSnapshotOnly({ setup: { view_global: true } });
    const res = mockRes();
    const next = jest.fn();

    await authorizePermission(["setup.company-name", "setup"], "create")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("uses the LIVE permission from the roles table, not the stale JWT snapshot, when a role id is present", async () => {
    // Snapshot (baked in at login) still says "create: true"; the live row
    // says it was revoked since. The live value must win -- this is the
    // entire point of Finding 4's fix.
    mockMaybeSingle.mockResolvedValue({
      data: { permissions: { purchase: { create: false } }, status: "Active", is_delete: false },
      error: null,
    });
    const req = reqWithRoleId("role-1", { purchase: { create: true } });
    const res = mockRes();
    const next = jest.fn();

    await authorizePermission("purchase", "create")(req, res, next);

    expect(mockFrom).toHaveBeenCalledWith("roles");
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("grants access based on a live permission that was added after login (not in the stale snapshot)", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { permissions: { purchase: { create: true } }, status: "Active", is_delete: false },
      error: null,
    });
    const req = reqWithRoleId("role-1", { purchase: { create: false } });
    const res = mockRes();
    const next = jest.fn();

    await authorizePermission("purchase", "create")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("denies access when the role has since been soft-deleted, even if the JWT snapshot would have granted it", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { permissions: { purchase: { create: true } }, status: "Active", is_delete: true },
      error: null,
    });
    const req = reqWithRoleId("role-1", { purchase: { create: true } });
    const res = mockRes();
    const next = jest.fn();

    await authorizePermission("purchase", "create")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("denies access when the role has since been deactivated", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { permissions: { purchase: { create: true } }, status: "Inactive", is_delete: false },
      error: null,
    });
    const req = reqWithRoleId("role-1", { purchase: { create: true } });
    const res = mockRes();
    const next = jest.fn();

    await authorizePermission("purchase", "create")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("falls back to the JWT snapshot if the live lookup errors out (DB hiccup), instead of hard-failing", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: "connection reset" } });
    const req = reqWithRoleId("role-1", { purchase: { create: true } });
    const res = mockRes();
    const next = jest.fn();

    await authorizePermission("purchase", "create")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("falls back to the JWT snapshot if the live lookup throws", async () => {
    mockMaybeSingle.mockRejectedValue(new Error("network error"));
    const req = reqWithRoleId("role-1", { purchase: { create: true } });
    const res = mockRes();
    const next = jest.fn();

    await authorizePermission("purchase", "create")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("authorizeView", () => {
  it("grants full access and sets no viewOwnFilter when the role has view_global", async () => {
    const req = reqWithSnapshotOnly({ order: { view_global: true } });
    const res = mockRes();
    const next = jest.fn();

    await authorizeView("order", "created_by")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.viewOwnFilter).toBeUndefined();
  });

  it("sets viewOwnFilter when the role has only view_own", async () => {
    const req = { user: { id: "staff-1", roleData: { permissions: { order: { view_own: true } } } } };
    const res = mockRes();
    const next = jest.fn();

    await authorizeView("order", "created_by")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.viewOwnFilter).toEqual({ column: "created_by", value: "staff-1" });
  });

  it("returns 403 when neither view_global nor view_own is granted", async () => {
    const req = reqWithSnapshotOnly({ order: { create: true } });
    const res = mockRes();
    const next = jest.fn();

    await authorizeView("order", "created_by")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
