const request = require("supertest");
const app = require("../../app");

// Smoke coverage that the routes added/touched by the audit patches are
// actually wired up and still require authentication — i.e. this catches
// a route file that forgets `router.use(authenticateToken)` or a typo in
// the mount path, without needing a live database.
describe("auth-gated routes reject unauthenticated requests", () => {
  const routes = [
    ["get", "/api/staff/bulk/template"],
    ["get", "/api/material/bulk/template"],
    ["get", "/api/productItem/bulk/template"],
    ["get", "/api/lead/create/bulk/template"],
    ["get", "/api/purchase/bulk/template"],
    ["get", "/api/account-master/bulk-create/template"],
    ["get", "/api/vendor/bulk/template"],
    ["get", "/api/import-history/vendor"],
    ["get", "/api/orders/getall"],
    ["get", "/api/staff/getall"],
  ];

  it.each(routes)("%s %s -> 401 without a token", async (method, url) => {
    const res = await request(app)[method](url);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("rejects a garbage token with 403, not a 500", async () => {
    const res = await request(app).get("/api/vendor/getall").set("Authorization", "Bearer garbage");
    expect(res.status).toBe(403);
  });
});
