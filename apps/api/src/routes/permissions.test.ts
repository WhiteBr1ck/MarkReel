import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dbPath = path.join(os.tmpdir(), `markreel-permissions-${process.pid}-${Date.now()}.db`);
process.env.MARKREEL_SKIP_BOOTSTRAP = "true";
process.env.MARKREEL_STORE = "sqlite";
process.env.MARKREEL_ALLOW_PUBLIC_REGISTRATION = "true";
process.env.WEB_BASE_URL = "http://localhost:5090";
process.env.API_BASE_URL = "http://localhost:4000";
process.env.JWT_ACCESS_SECRET = "test_access_secret_change_me_123456";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret_change_me_123456";
process.env.JWT_AUTH_INSTANCE_ID = "permissions-test-instance";
process.env.DATABASE_URL = `file:${dbPath.replace(/\\/g, "/")}`;
process.env.S3_ENDPOINT = "http://127.0.0.1:1";
process.env.S3_REGION = "us-east-1";
process.env.S3_ACCESS_KEY = "test";
process.env.S3_SECRET_KEY = "test";
process.env.S3_BUCKET_ORIGINAL = "original";
process.env.S3_BUCKET_DERIVED = "derived";
process.env.S3_BUCKET_ATTACHMENTS = "attachments";

const appModule = import("../main");
const dbModule = import("../db");

async function setupSchema(prisma: Awaited<typeof dbModule>["prisma"]) {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL UNIQUE,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarObjectKey" TEXT,
    "avatarContentType" TEXT,
    "avatarPreset" TEXT,
    "globalRole" TEXT NOT NULL DEFAULT 'user',
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "lastLoginAt" DATETIME,
    "disabledAt" DATETIME,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "OrganizationMember" (
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" DATETIME NOT NULL,
    PRIMARY KEY ("organizationId", "userId")
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "organizationId" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ProjectMember" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    PRIMARY KEY ("projectId", "userId")
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ProjectPermissionGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL DEFAULT '',
    "subjectUserId" TEXT,
    "permission" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL
  )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ProjectPermissionGrant_projectId_subjectType_subjectKey_permission_key" ON "ProjectPermissionGrant"("projectId", "subjectType", "subjectKey", "permission")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Media" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "creatorId" TEXT,
    "folderId" TEXT,
    "title" TEXT NOT NULL,
    "seriesId" TEXT,
    "versionIndex" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "reviewStatus" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "MediaPermissionGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL DEFAULT '',
    "subjectUserId" TEXT,
    "permission" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL
  )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "MediaPermissionGrant_mediaId_subjectType_subjectKey_permission_key" ON "MediaPermissionGrant"("mediaId", "subjectType", "subjectKey", "permission")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "MediaFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaId" TEXT NOT NULL,
    "originalObjectKey" TEXT NOT NULL,
    "derivedPrefix" TEXT,
    "thumbnailObjectKey" TEXT,
    "mode" TEXT NOT NULL,
    "durationMs" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "sizeBytes" BIGINT,
    "bitrateKbps" INTEGER,
    "frameCount" INTEGER,
    "createdAt" DATETIME NOT NULL
  )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "MediaFile_mediaId_originalObjectKey_key" ON "MediaFile"("mediaId", "originalObjectKey")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "MediaRating" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
  )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "MediaRating_mediaId_userId_key" ON "MediaRating"("mediaId", "userId")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Annotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "timestampMs" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "rect" JSONB,
    "body" TEXT NOT NULL,
    "color" TEXT,
    "completedAt" DATETIME,
    "completedById" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "annotationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" DATETIME NOT NULL
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "meta" JSONB,
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL
  )`);
}

function cookieHeader(response: { cookies: Array<{ name: string; value: string }> }) {
  return response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function createApp() {
  const { buildApp } = await appModule;
  const app = await buildApp();
  await app.ready();
  return app;
}

async function register(app: Awaited<ReturnType<typeof createApp>>, username: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { username, password: "password123" }
  });
  assert.equal(response.statusCode, 200);
  return { user: response.json().user as { id: string; username: string }, cookies: cookieHeader(response) };
}

test("media permissions use manage annotate view and restrict completion", async () => {
  const { prisma } = await dbModule;
  await setupSchema(prisma);
  const app = await createApp();
  try {
    const owner = await register(app, "owner_perm");
    const annotator = await register(app, "annotator_perm");
    const viewer = await register(app, "viewer_perm");

    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie: owner.cookies },
      payload: { name: "Permission Project" }
    });
    assert.equal(projectResponse.statusCode, 201);
    const projectId = projectResponse.json().project.id as string;

    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { organizationId: true } });
    assert.ok(project?.organizationId);
    await Promise.all([annotator.user.id, viewer.user.id].map((userId) => prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: project.organizationId!, userId } },
      update: {},
      create: { organizationId: project.organizationId!, userId, role: "member" }
    })));

    const projectPermissions = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/permissions`,
      headers: { cookie: owner.cookies },
      payload: { grants: [{ subjectType: "organization", permission: "view" }] }
    });
    assert.equal(projectPermissions.statusCode, 200);

    const mediaResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/media`,
      headers: { cookie: owner.cookies },
      payload: { title: "Cut 01" }
    });
    assert.equal(mediaResponse.statusCode, 201);
    const mediaId = mediaResponse.json().media.id as string;

    const rejectedCommentPermission = await app.inject({
      method: "PUT",
      url: `/api/media/${mediaId}/permissions`,
      headers: { cookie: owner.cookies },
      payload: { grants: [{ subjectType: "invited_user", subjectUserId: annotator.user.id, permission: "comment" }] }
    });
    assert.equal(rejectedCommentPermission.statusCode, 400);
    assert.equal(rejectedCommentPermission.json().error, "validation_error");

    const mediaPermissions = await app.inject({
      method: "PUT",
      url: `/api/media/${mediaId}/permissions`,
      headers: { cookie: owner.cookies },
      payload: { grants: [{ subjectType: "invited_user", subjectUserId: annotator.user.id, permission: "annotate" }] }
    });
    assert.equal(mediaPermissions.statusCode, 200);

    const ownerMediaDetail = await app.inject({
      method: "GET",
      url: `/api/media/${mediaId}`,
      headers: { cookie: owner.cookies }
    });
    assert.equal(ownerMediaDetail.statusCode, 200);
    const detail = ownerMediaDetail.json().media;
    for (const capability of ["media:view", "media:annotate", "media:manage", "media:complete_own_annotations", "media:complete_any_annotation"]) {
      assert.ok(detail.capabilities.includes(capability));
    }
    assert.ok(detail.projectCapabilities.includes("project:manage_members"));

    const viewerCreate = await app.inject({
      method: "POST",
      url: `/api/media/${mediaId}/annotations`,
      headers: { cookie: viewer.cookies },
      payload: { timestampMs: 1000, type: "text", body: "viewer should not annotate", attachments: [] }
    });
    assert.equal(viewerCreate.statusCode, 403);

    const created = await app.inject({
      method: "POST",
      url: `/api/media/${mediaId}/annotations`,
      headers: { cookie: annotator.cookies },
      payload: { timestampMs: 1200, type: "text", body: "needs polish", attachments: [] }
    });
    assert.equal(created.statusCode, 201);
    const annotationId = created.json().id as string;

    const viewerCompletion = await app.inject({
      method: "PATCH",
      url: `/api/annotations/${annotationId}/completion`,
      headers: { cookie: viewer.cookies },
      payload: { completed: true }
    });
    assert.equal(viewerCompletion.statusCode, 403);

    const authorCompletion = await app.inject({
      method: "PATCH",
      url: `/api/annotations/${annotationId}/completion`,
      headers: { cookie: annotator.cookies },
      payload: { completed: true }
    });
    assert.equal(authorCompletion.statusCode, 200);
    assert.ok(authorCompletion.json().completedAt);

    const managerCompletion = await app.inject({
      method: "PATCH",
      url: `/api/annotations/${annotationId}/completion`,
      headers: { cookie: owner.cookies },
      payload: { completed: false }
    });
    assert.equal(managerCompletion.statusCode, 200);
    assert.equal(managerCompletion.json().completedAt, null);
  } finally {
    await app.close();
    await prisma.$disconnect();
    if (existsSync(dbPath)) rmSync(dbPath, { force: true });
  }
});
