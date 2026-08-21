const { authorizePermission } = require("../../middleware/authorize");

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("authorizePermission", () => {
  it("calls next() when the role has the required permission", () => {
    const req = { user: { roleData: { permissions: { purchase: { create: true } } } } };
    const res = mockRes();
    const next = jest.fn();

    authorizePermission("purchase", "create")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 when the role lacks the required action for the module", () => {
    const req = { user: { roleData: { permissions: { purchase: { view_global: true } } } } };
    const res = mockRes();
    const next = jest.fn();

    authorizePermission("purchase", "create")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 403 when the module key isn't present in permissions at all", () => {
    const req = { user: { roleData: { permissions: { purchase: { create: true } } } } };
    const res = mockRes();
    const next = jest.fn();

    authorizePermission("vendor", "create")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 403 when no permissions object exists on the token at all", () => {
    const req = { user: {} };
    const res = mockRes();
    const next = jest.fn();

    authorizePermission("purchase", "create")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("falls back through an array of module keys, taking the first that grants the action", () => {
    const req = { user: { roleData: { permissions: { setup: { create: true } } } } };
    const res = mockRes();
    const next = jest.fn();

    authorizePermission(["setup.company-name", "setup"], "create")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("denies when none of the fallback keys grant the action", () => {
    const req = { user: { roleData: { permissions: { setup: { view_global: true } } } } };
    const res = mockRes();
    const next = jest.fn();

    authorizePermission(["setup.company-name", "setup"], "create")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
