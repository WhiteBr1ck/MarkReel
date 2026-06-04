import assert from "node:assert/strict";
import test from "node:test";

process.env.MARKREEL_SKIP_BOOTSTRAP = "true";
process.env.MARKREEL_STORE = "inmemory";
process.env.MARKREEL_ALLOW_PUBLIC_REGISTRATION = "false";
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

const appModule = import("../main");

test("public registration is disabled by default config", async () => {
  const { buildApp } = await appModule;
  const app = await buildApp();
  await app.ready();
  try {
    const disabled = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "grace", password: "password123" } });
    assert.equal(disabled.statusCode, 403);
    assert.equal(disabled.json().error, "public_registration_disabled");
  } finally {
    await app.close();
  }
});
