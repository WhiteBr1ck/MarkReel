import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";

export async function assertDeletedCredentialsStayInvalid(app: FastifyInstance, prefix: string) {
  const admin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "adminadmin" } });
  assert.equal(admin.statusCode, 200);
  const adminCookie = admin.cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  for (const recreation of ["register", "admin"] as const) {
    const username = `${prefix}_${recreation}`;
    const original = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username, password: "password123" } });
    assert.equal(original.statusCode, 200);
    const userId = original.json().user.id as string;
    const cookie = original.cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
    const issued = await app.inject({ method: "POST", url: "/api/users/me/api-tokens", headers: { cookie }, payload: { name: "Before deletion" } });
    assert.equal(issued.statusCode, 201);
    const authorization = `Bearer ${issued.json().token}`;
    const deleted = await app.inject({ method: "DELETE", url: `/api/admin/users/${userId}`, headers: { cookie: adminCookie } });
    assert.equal(deleted.statusCode, 200);
    const recreated = await app.inject({
      method: "POST", url: recreation === "register" ? "/api/auth/register" : "/api/admin/users",
      headers: recreation === "admin" ? { cookie: adminCookie } : {},
      payload: { username, password: "newpassword123" }
    });
    assert.equal(recreated.statusCode, recreation === "register" ? 200 : 201);
    assert.equal(recreated.json().user.id, userId);
    assert.equal((await app.inject({ method: "GET", url: "/api/me", headers: { authorization } })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/api/auth/refresh", headers: { cookie } })).statusCode, 401);
    const newLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "newpassword123" } });
    assert.equal(newLogin.statusCode, 200);
  }
}
