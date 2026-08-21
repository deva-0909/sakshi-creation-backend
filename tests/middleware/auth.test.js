const jwt = require("jsonwebtoken");
const { authenticateToken } = require("../../middleware/auth");

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("authenticateToken", () => {
  const OLD_SECRET = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = "test-secret";
  });

  afterAll(() => {
    process.env.JWT_SECRET = OLD_SECRET;
  });

  it("returns 401 when no Authorization header is present", () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 for a malformed/invalid token", () => {
    const req = { headers: { authorization: "Bearer not-a-real-token" } };
    const res = mockRes();
    const next = jest.fn();

    authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches the decoded payload to req.user and calls next() for a valid token", () => {
    const token = jwt.sign({ id: "staff-1", role: "admin" }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();

    authenticateToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ id: "staff-1", role: "admin" });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 for a token signed with a different secret", () => {
    const token = jwt.sign({ id: "staff-1" }, "wrong-secret");
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();

    authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
