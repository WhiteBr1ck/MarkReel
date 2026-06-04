import assert from "node:assert/strict";
import test from "node:test";

process.env.MARKREEL_SKIP_BOOTSTRAP = "true";
process.env.MARKREEL_STORE = "inmemory";
process.env.MARKREEL_ALLOW_PUBLIC_REGISTRATION = "true";
process.env.WEB_BASE_URL = "http://localhost:5090";
process.env.API_BASE_URL = "http://localhost:4000";
process.env.JWT_ACCESS_SECRET = "test_access_secret_change_me_123456";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret_change_me_123456";
process.env.S3_ENDPOINT = "http://localhost:9000";
process.env.S3_REGION = "us-east-1";
process.env.S3_ACCESS_KEY = "test";
process.env.S3_SECRET_KEY = "test";
process.env.S3_BUCKET_ORIGINAL = "original";
process.env.S3_BUCKET_DERIVED = "derived";
process.env.S3_BUCKET_ATTACHMENTS = "attachments";
process.env.MARKREEL_ADMIN_USERNAME = "admin";
process.env.MARKREEL_ADMIN_PASSWORD = "adminpass123";

const appModule = import("../main");

function cookieHeader(response: { cookies: Array<{ name: string; value: string }> }) {
  return response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function createApp() {
  const { buildApp } = await appModule;
  const app = await buildApp();
  await app.ready();
  return app;
}

test("registers and logs in a user", async () => {
  const app = await createApp();
  try {
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "alice", password: "password123", displayName: "Alice" }
    });
    assert.equal(registered.statusCode, 200);
    assert.equal(registered.json().user.username, "alice");
    assert.ok(registered.cookies.some((cookie) => cookie.name === "mr_access"));

    const loggedIn = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice", password: "password123" }
    });
    assert.equal(loggedIn.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("rejects invalid login and duplicate registration", async () => {
  const app = await createApp();
  try {
    await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "bob", password: "password123" } });

    const duplicate = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "bob", password: "password123" } });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.json().error, "username_taken");

    const invalid = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "bob", password: "wrongpass123" } });
    assert.equal(invalid.statusCode, 401);
    assert.equal(invalid.json().error, "invalid_credentials");
  } finally {
    await app.close();
  }
});

test("change password invalidates old session", async () => {
  const app = await createApp();
  try {
    const registered = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "carol", password: "password123" } });
    const oldCookies = cookieHeader(registered);

    const changed = await app.inject({
      method: "POST",
      url: "/api/users/me/change-password",
      headers: { cookie: oldCookies },
      payload: { currentPassword: "password123", newPassword: "newpass123" }
    });
    assert.equal(changed.statusCode, 200);

    const oldSession = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: oldCookies } });
    assert.equal(oldSession.statusCode, 401);

    const newLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "carol", password: "newpass123" } });
    assert.equal(newLogin.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("deleted user cannot log in", async () => {
  const app = await createApp();
  try {
    const registered = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "dana", password: "password123" } });
    const cookies = cookieHeader(registered);

    const deleted = await app.inject({
      method: "POST",
      url: "/api/users/me/delete-account",
      headers: { cookie: cookies },
      payload: { currentPassword: "password123" }
    });
    assert.equal(deleted.statusCode, 200);

    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "dana", password: "password123" } });
    assert.equal(login.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("non-admin cannot access admin users", async () => {
  const app = await createApp();
  try {
    const registered = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "erin", password: "password123" } });
    const denied = await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: cookieHeader(registered) } });
    assert.equal(denied.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("admin resets password and old user session is rejected", async () => {
  const app = await createApp();
  try {
    const admin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "adminpass123" } });
    assert.equal(admin.statusCode, 200);
    const adminCookies = cookieHeader(admin);

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: { cookie: adminCookies },
      payload: { username: "frank", password: "password123" }
    });
    assert.equal(created.statusCode, 201);
    const userId = created.json().user.id;

    const userLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "frank", password: "password123" } });
    const oldUserCookies = cookieHeader(userLogin);

    const reset = await app.inject({
      method: "POST",
      url: `/api/admin/users/${userId}/reset-password`,
      headers: { cookie: adminCookies },
      payload: { newPassword: "newpass123" }
    });
    assert.equal(reset.statusCode, 200);

    const oldSession = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: oldUserCookies } });
    assert.equal(oldSession.statusCode, 401);

    const newLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "frank", password: "newpass123" } });
    assert.equal(newLogin.statusCode, 200);
  } finally {
    await app.close();
  }
});
