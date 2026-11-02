import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { getMediaAccess, getProjectAccess, hasCapability, hasMediaCapability } from "./access";

export class MediaSeriesError extends Error {
  constructor(public readonly code: string, public readonly statusCode = 404) {
    super(code);
  }
}

export type CreateMediaVersionInput = {
  userId: string;
  projectId: string;
  title: string;
  folderId?: string | null;
  sourceMediaId?: string;
  seriesId?: string;
};

const versionSelect = {
  id: true, projectId: true, folderId: true, title: true, seriesId: true,
  versionIndex: true, status: true, reviewStatus: true, createdAt: true, updatedAt: true
} as const;

async function transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(run, { maxWait: 10000, timeout: 15000 });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      const busy = error instanceof Error && /SQLITE_BUSY|database is locked/i.test(error.message);
      if (attempt >= 4 || (!busy && code !== "P2034" && code !== "P1008" && code !== "P2028")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
    }
  }
}

export async function authorizeMediaVersionTarget(input: CreateMediaVersionInput) {
  const projectAccess = await getProjectAccess(input);
  if (!hasCapability(projectAccess, "project:upload")) throw new MediaSeriesError("not_found");

  let sourceMediaId = input.sourceMediaId;
  if (!sourceMediaId && input.seriesId) {
    const source = await prisma.media.findFirst({
      where: { projectId: input.projectId, seriesId: input.seriesId, deletedAt: null, series: { deletedAt: null, projectId: input.projectId } },
      orderBy: { versionIndex: "desc" }, select: { id: true }
    });
    if (source) {
      sourceMediaId = source.id;
    } else {
      const existingSeries = await prisma.mediaSeries.findFirst({
        where: { id: input.seriesId, projectId: input.projectId, deletedAt: null }, select: { id: true }
      });
      if (!existingSeries || !hasCapability(projectAccess, "project:manage_members")) throw new MediaSeriesError("not_found");
    }
  }
  if (sourceMediaId) {
    const result = await getMediaAccess({ userId: input.userId, mediaId: sourceMediaId });
    if (!result || result.media.projectId !== input.projectId || !hasMediaCapability(result.access, "media:manage")) {
      throw new MediaSeriesError("not_found");
    }
  }
  return sourceMediaId;
}

export async function createMediaVersion(input: CreateMediaVersionInput) {
  const sourceMediaId = await authorizeMediaVersionTarget(input);
  return transaction(async (tx) => {
    // SQLite has one writer. Take its write lock before reading a legacy source or its counter.
    if (sourceMediaId) {
      await tx.$executeRaw`UPDATE "Media" SET "versionIndex" = "versionIndex" WHERE "id" = ${sourceMediaId} AND "projectId" = ${input.projectId} AND "deletedAt" IS NULL`;
    } else if (input.seriesId) {
      await tx.$executeRaw`UPDATE "MediaSeries" SET "title" = "title" WHERE "id" = ${input.seriesId} AND "projectId" = ${input.projectId} AND "deletedAt" IS NULL`;
    }
    const project = await tx.project.findFirst({ where: { id: input.projectId, deletedAt: null }, select: { id: true } });
    if (!project) throw new MediaSeriesError("not_found");

    const source = sourceMediaId ? await tx.media.findFirst({
      where: { id: sourceMediaId, projectId: input.projectId, deletedAt: null }, select: versionSelect
    }) : null;
    if (sourceMediaId && !source) throw new MediaSeriesError("not_found");
    if (input.seriesId && source && source.seriesId !== input.seriesId) throw new MediaSeriesError("not_found");

    const folderId = input.folderId === undefined ? source?.folderId ?? null : input.folderId;
    if (folderId && !await tx.projectFolder.findFirst({ where: { id: folderId, projectId: input.projectId, deletedAt: null }, select: { id: true } })) {
      throw new MediaSeriesError("folder_not_found");
    }

    let seriesId = source?.seriesId ?? input.seriesId ?? null;
    let versionIndex = 1;
    if (source && !seriesId) {
      const series = await tx.mediaSeries.create({ data: { projectId: input.projectId, title: source.title }, select: { id: true } });
      seriesId = series.id;
      await tx.media.update({ where: { id: source.id }, data: { seriesId, versionIndex: 1 } });
    }
    if (seriesId) {
      // Include soft-deleted versions and the persistent high-water mark, never recycling numbers.
      const counters = await tx.$queryRaw<Array<{ nextVersionIndex: number | bigint }>>`
        UPDATE "MediaSeries"
        SET "nextVersionIndex" = MAX("nextVersionIndex", COALESCE((SELECT MAX("versionIndex") FROM "Media" WHERE "seriesId" = ${seriesId}), 0)) + 1
        WHERE "id" = ${seriesId} AND "projectId" = ${input.projectId} AND "deletedAt" IS NULL
        RETURNING "nextVersionIndex"`;
      if (!counters[0]) throw new MediaSeriesError("not_found");
      versionIndex = Number(counters[0].nextVersionIndex);
      if (!Number.isSafeInteger(versionIndex) || versionIndex > 2147483647) throw new MediaSeriesError("version_limit_reached", 409);
    }

    return tx.media.create({
      data: {
        projectId: input.projectId, creatorId: input.userId, folderId, title: input.title,
        seriesId, versionIndex,
        permissionGrants: { create: (["manage", "annotate", "view"] as const).map((permission) => ({ subjectType: "creator", subjectKey: "", permission })) }
      },
      select: versionSelect
    });
  });
}

type VersionFile = { originalObjectKey: string; mode?: string; derivedPrefix?: string | null };
export function isMediaVersionAvailable(media: { status: string; files: VersionFile[] }) {
  const file = media.files[0];
  return media.status === "ready" && Boolean(file?.originalObjectKey && (file.mode !== "compress" || file.derivedPrefix));
}

export function groupMediaVersions<T extends {
  id: string; seriesId: string | null; versionIndex: number; status: string; files: VersionFile[];
}>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.seriesId ? `series:${item.seriesId}` : `media:${item.id}`;
    const versions = groups.get(key) ?? [];
    versions.push(item);
    groups.set(key, versions);
  }
  return [...groups.values()].map((versions) => {
    versions.sort((a, b) => b.versionIndex - a.versionIndex || a.id.localeCompare(b.id));
    const selected = versions.find(isMediaVersionAvailable) ?? versions.find((item) => item.files.length > 0 && item.status !== "failed") ?? versions[0];
    return { ...selected, versionCount: versions.length };
  });
}

export async function getMediaVersionHistory(userId: string, mediaId: string) {
  const anchorAccess = await getMediaAccess({ userId, mediaId });
  if (!anchorAccess || !hasMediaCapability(anchorAccess.access, "media:view")) throw new MediaSeriesError("not_found");
  const anchor = await prisma.media.findFirst({ where: { id: mediaId, deletedAt: null }, select: versionSelect });
  if (!anchor) throw new MediaSeriesError("not_found");
  const candidates = await prisma.media.findMany({
    where: {
      projectId: anchor.projectId, deletedAt: null,
      ...(anchor.seriesId ? { seriesId: anchor.seriesId, series: { projectId: anchor.projectId, deletedAt: null } } : { id: mediaId })
    },
    select: {
      ...versionSelect, creator: { select: { id: true, username: true, displayName: true } },
      files: { select: { originalObjectKey: true, mode: true, derivedPrefix: true }, orderBy: { createdAt: "desc" }, take: 1 }
    },
    orderBy: [{ versionIndex: "desc" }, { createdAt: "desc" }]
  });
  const versions = [];
  let allManageable = true;
  for (const candidate of candidates) {
    const result = await getMediaAccess({ userId, mediaId: candidate.id });
    if (!result || !hasMediaCapability(result.access, "media:view")) { allManageable = false; continue; }
    const canManage = hasMediaCapability(result.access, "media:manage");
    allManageable &&= canManage;
    const { files, ...version } = candidate;
    versions.push({ ...version, available: isMediaVersionAvailable(candidate), canManage });
  }
  return {
    seriesId: anchor.seriesId, versions,
    canUploadVersion: hasCapability(anchorAccess.access.projectAccess, "project:upload") && hasMediaCapability(anchorAccess.access, "media:manage"),
    canDeleteSeries: Boolean(anchor.seriesId && candidates.length > 0 && allManageable && hasCapability(anchorAccess.access.projectAccess, "project:manage_members"))
  };
}

export async function deleteMediaSeries(userId: string, projectId: string, seriesId: string) {
  const access = await getProjectAccess({ userId, projectId });
  if (!hasCapability(access, "project:manage_members")) throw new MediaSeriesError("not_found");
  return transaction(async (tx) => {
    const result = await tx.mediaSeries.updateMany({ where: { id: seriesId, projectId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!result.count) throw new MediaSeriesError("not_found");
    return tx.media.updateMany({ where: { projectId, seriesId, deletedAt: null }, data: { deletedAt: new Date() } });
  });
}
