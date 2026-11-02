import type { PrismaClient } from "@prisma/client";

// Isolated SQLite fixtures follow the existing permissions tests, without invoking the migration CLI.
export async function setupMediaSeriesTestSchema(prisma: PrismaClient) {
  const statements = [
    `CREATE TABLE "User" (
      "id" TEXT PRIMARY KEY, "username" TEXT NOT NULL UNIQUE, "passwordHash" TEXT NOT NULL,
      "displayName" TEXT, "avatarObjectKey" TEXT, "avatarContentType" TEXT, "avatarPreset" TEXT,
      "globalRole" TEXT NOT NULL DEFAULT 'user', "sessionVersion" INTEGER NOT NULL DEFAULT 1,
      "lastLoginAt" DATETIME, "disabledAt" DATETIME, "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL, "deletedAt" DATETIME
    )`,
    `CREATE TABLE "Project" (
      "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "organizationId" TEXT,
      "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL, "deletedAt" DATETIME
    )`,
    `CREATE TABLE "Organization" (
      "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "createdById" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL, "deletedAt" DATETIME
    )`,
    `CREATE TABLE "OrganizationMember" (
      "organizationId" TEXT NOT NULL, "userId" TEXT NOT NULL, "role" TEXT NOT NULL DEFAULT 'member', "createdAt" DATETIME NOT NULL,
      PRIMARY KEY ("organizationId", "userId")
    )`,
    `CREATE TABLE "ProjectMember" (
      "projectId" TEXT NOT NULL, "userId" TEXT NOT NULL, "role" TEXT NOT NULL, "createdAt" DATETIME NOT NULL,
      PRIMARY KEY ("projectId", "userId")
    )`,
    `CREATE TABLE "ProjectPermissionGrant" (
      "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "subjectType" TEXT NOT NULL, "subjectKey" TEXT NOT NULL DEFAULT '',
      "subjectUserId" TEXT, "permission" TEXT NOT NULL, "createdAt" DATETIME NOT NULL
    )`,
    `CREATE TABLE "ProjectFolder" (
      "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "parentId" TEXT, "name" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL, "deletedAt" DATETIME
    )`,
    `CREATE TABLE "MediaSeries" (
      "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "title" TEXT NOT NULL,
      "nextVersionIndex" INTEGER NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL, "deletedAt" DATETIME
    )`,
    `CREATE TABLE "Media" (
      "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "creatorId" TEXT, "folderId" TEXT, "title" TEXT NOT NULL,
      "seriesId" TEXT, "versionIndex" INTEGER NOT NULL DEFAULT 1, "status" TEXT NOT NULL DEFAULT 'uploaded',
      "reviewStatus" TEXT NOT NULL DEFAULT 'open', "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL, "deletedAt" DATETIME
    )`,
    `CREATE UNIQUE INDEX "Media_seriesId_versionIndex_key" ON "Media"("seriesId", "versionIndex")`,
    `CREATE TABLE "MediaPermissionGrant" (
      "id" TEXT PRIMARY KEY, "mediaId" TEXT NOT NULL, "subjectType" TEXT NOT NULL, "subjectKey" TEXT NOT NULL DEFAULT '',
      "subjectUserId" TEXT, "permission" TEXT NOT NULL, "createdAt" DATETIME NOT NULL,
      FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE
    )`,
    `CREATE TABLE "MediaFile" (
      "id" TEXT PRIMARY KEY, "mediaId" TEXT NOT NULL, "originalObjectKey" TEXT NOT NULL, "derivedPrefix" TEXT, "thumbnailObjectKey" TEXT,
      "mode" TEXT NOT NULL, "durationMs" INTEGER, "width" INTEGER, "height" INTEGER, "sizeBytes" BIGINT,
      "bitrateKbps" INTEGER, "frameCount" INTEGER, "formatName" TEXT, "videoCodec" TEXT, "videoProfile" TEXT,
      "videoPixelFormat" TEXT, "videoFrameRate" REAL, "videoBitrateKbps" INTEGER, "audioCodec" TEXT,
      "audioBitrateKbps" INTEGER, "technicalMetadataProbedAt" DATETIME, "createdAt" DATETIME NOT NULL
    )`,
    `CREATE TABLE "MediaRating" (
      "id" TEXT PRIMARY KEY, "mediaId" TEXT NOT NULL, "userId" TEXT NOT NULL, "value" INTEGER NOT NULL,
      "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL
    )`,
    `CREATE TABLE "Annotation" (
      "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "mediaId" TEXT NOT NULL, "authorId" TEXT NOT NULL, "parentId" TEXT,
      "timestampMs" INTEGER NOT NULL, "type" TEXT NOT NULL, "rect" JSONB, "body" TEXT NOT NULL, "color" TEXT,
      "completedAt" DATETIME, "completedById" TEXT, "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL, "deletedAt" DATETIME
    )`,
    `CREATE TABLE "Attachment" (
      "id" TEXT PRIMARY KEY, "annotationId" TEXT NOT NULL, "kind" TEXT NOT NULL, "objectKey" TEXT NOT NULL,
      "mimeType" TEXT, "width" INTEGER, "height" INTEGER, "createdAt" DATETIME NOT NULL
    )`,
    `CREATE TABLE "ShareLink" (
      "id" TEXT PRIMARY KEY, "tokenHash" TEXT NOT NULL UNIQUE, "projectId" TEXT, "mediaId" TEXT, "createdById" TEXT,
      "label" TEXT, "audience" TEXT NOT NULL DEFAULT 'anyone', "passwordHash" TEXT, "maxUses" INTEGER,
      "useCount" INTEGER NOT NULL DEFAULT 0, "lastUsedAt" DATETIME, "expiresAt" DATETIME, "revokedAt" DATETIME, "createdAt" DATETIME NOT NULL
    )`,
    `CREATE TABLE "ShareLinkPermission" (
      "id" TEXT PRIMARY KEY, "shareLinkId" TEXT NOT NULL, "permission" TEXT NOT NULL
    )`,
    `CREATE TABLE "AuditLog" (
      "id" TEXT PRIMARY KEY, "actorUserId" TEXT, "action" TEXT NOT NULL, "entityType" TEXT NOT NULL,
      "entityId" TEXT NOT NULL, "meta" JSONB, "ip" TEXT, "createdAt" DATETIME NOT NULL
    )`
  ];
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
}
