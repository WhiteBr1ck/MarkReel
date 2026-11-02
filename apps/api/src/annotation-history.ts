import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";
import { env } from "./env";

type Row = Prisma.AnnotationGetPayload<{ include: { attachments: true } }>;
type Snapshot = Omit<Row, "createdAt" | "updatedAt" | "deletedAt" | "completedAt" | "attachments"> & {
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  completedAt: string | null;
  attachments: Array<Omit<Row["attachments"][number], "createdAt"> & { createdAt: string }>;
};

const ReceiptSchema = z.object({
  version: z.literal(1),
  actorId: z.string(),
  channel: z.string(),
  mediaId: z.string(),
  rootId: z.string(),
  annotationId: z.string(),
  authorId: z.string(),
  operation: z.enum(["create", "edit", "delete", "completion"]),
  desired: z.string(),
  expectedHash: z.string(),
  deletedVersions: z.record(z.string()),
  expiresAt: z.number()
});
export type AnnotationHistoryReceipt = z.infer<typeof ReceiptSchema>;
export const AnnotationHistoryInput = z.object({ historyToken: z.string().min(1).max(900000) });
export const ExpectedAnnotationVersion = z.string().datetime().optional();

function historyError(code: string, statusCode = 409) {
  return Object.assign(new Error(code), { code, statusCode });
}

function hash(value: string) {
  const rows = JSON.parse(value) as Snapshot[];
  // Replayed local history changes revisions, not content. Excluding only that
  // server-owned field lets consecutive undo/redo work while preserving edits.
  return createHash("sha256").update(JSON.stringify(rows.map(({ updatedAt: _version, ...row }) => row))).digest("hex");
}

function sign(receipt: AnnotationHistoryReceipt) {
  const payload = Buffer.from(JSON.stringify(receipt)).toString("base64url");
  const signature = createHmac("sha256", env.JWT_ACCESS_SECRET).update(`annotation-history:${payload}`).digest("base64url");
  const token = `${payload}.${signature}`;
  return token.length <= 850000 ? token : undefined;
}

export function readAnnotationHistory(token: string, actorId: string, channel: string) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw historyError("invalid_history", 400);
  const expected = createHmac("sha256", env.JWT_ACCESS_SECRET).update(`annotation-history:${payload}`).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw historyError("invalid_history", 400);
  let receipt: AnnotationHistoryReceipt;
  try {
    receipt = ReceiptSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    throw historyError("invalid_history", 400);
  }
  if (receipt.actorId !== actorId || receipt.channel !== channel) throw historyError("forbidden", 403);
  if (receipt.expiresAt < Date.now()) throw historyError("history_expired");
  return receipt;
}

async function capture(tx: Prisma.TransactionClient, rootId: string) {
  const rows = await tx.annotation.findMany({
    where: { deletedAt: null, OR: [{ id: rootId }, { parentId: rootId }] },
    orderBy: { id: "asc" },
    include: { attachments: { orderBy: { id: "asc" } } }
  });
  return JSON.stringify(rows);
}

function nextVersion(snapshot: string) {
  const rows = JSON.parse(snapshot) as Snapshot[];
  return new Date(Math.max(Date.now(), ...rows.map((row) => Date.parse(row.updatedAt) + 1)));
}

async function transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  try {
    return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P1008"].includes(error.code)) throw historyError("annotation_conflict");
    throw error;
  }
}

async function deletedVersions(tx: Prisma.TransactionClient, desired: string, current: string) {
  const currentIds = new Set((JSON.parse(current) as Snapshot[]).map((row) => row.id));
  const missing = (JSON.parse(desired) as Snapshot[]).filter((row) => !currentIds.has(row.id));
  const rows = await tx.annotation.findMany({ where: { id: { in: missing.map((row) => row.id) }, deletedAt: { not: null } }, select: { id: true, updatedAt: true } });
  return Object.fromEntries(rows.map((row) => [row.id, row.updatedAt.toISOString()]));
}

// The signed snapshot survives restarts without a history table. Its full-thread
// fingerprint prevents an undo from discarding another reviewer's reply or edit.
export async function mutateAnnotationWithHistory<T extends { id: string }>(
  args: {
    actorId: string;
    channel: string;
    mediaId: string;
    annotationId?: string;
    parentId?: string | null;
    expectedUpdatedAt?: string;
    operation: AnnotationHistoryReceipt["operation"];
  },
  mutate: (tx: Prisma.TransactionClient) => Promise<T>
) {
  return transaction(async (tx) => {
    const targetId = args.annotationId ?? args.parentId;
    const target = targetId ? await tx.annotation.findUnique({ where: { id: targetId } }) : null;
    if (targetId && (!target || target.deletedAt || target.mediaId !== args.mediaId)) throw historyError("annotation_conflict");
    if (args.expectedUpdatedAt && target?.updatedAt.toISOString() !== args.expectedUpdatedAt) throw historyError("annotation_conflict");
    if (target?.parentId) {
      const parent = await tx.annotation.findFirst({ where: { id: target.parentId, deletedAt: null } });
      if (!parent) throw historyError("annotation_conflict");
    }
    if (args.parentId && target?.parentId) throw historyError("parent_not_found", 404);
    const existingRootId = target?.parentId ?? target?.id;
    const before = existingRootId ? await capture(tx, existingRootId) : "[]";
    const version = nextVersion(before);
    if (existingRootId) {
      const root = (JSON.parse(before) as Snapshot[]).find((row) => row.id === existingRootId);
      if (!root) throw historyError("annotation_conflict");
      const claimed = await tx.annotation.updateMany({ where: { id: root.id, updatedAt: new Date(root.updatedAt), deletedAt: null }, data: { updatedAt: version } });
      if (claimed.count !== 1) throw historyError("annotation_conflict");
    }
    const result = await mutate(tx);
    const rootId = existingRootId ?? result.id;
    await tx.annotation.updateMany({ where: { id: { in: [rootId, result.id] } }, data: { updatedAt: version } });
    const after = await capture(tx, rootId);
    const row = ([...JSON.parse(after), ...JSON.parse(before)] as Snapshot[]).find((item) => item.id === result.id)!;
    return {
      ...result,
      updatedAt: version.toISOString(),
      historyToken: sign({
        version: 1,
        actorId: args.actorId,
        channel: args.channel,
        mediaId: args.mediaId,
        rootId,
        annotationId: result.id,
        authorId: row.authorId,
        operation: args.operation,
        desired: before,
        expectedHash: hash(after),
        deletedVersions: await deletedVersions(tx, before, after),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
      })
    };
  });
}

export async function applyAnnotationHistory(receipt: AnnotationHistoryReceipt) {
  return transaction(async (tx) => {
    const current = await capture(tx, receipt.rootId);
    if (hash(current) !== receipt.expectedHash) throw historyError("annotation_conflict");
    const currentRows = JSON.parse(current) as Snapshot[];
    const desiredRows = JSON.parse(receipt.desired) as Snapshot[];
    const desired = new Map(desiredRows.map((row) => [row.id, row]));
    const version = new Date(Math.max(nextVersion(current).getTime(), ...Object.values(receipt.deletedVersions).map((value) => Date.parse(value) + 1)));
    const rows = new Map([...desiredRows, ...currentRows].map((row) => [row.id, row]));
    const currentIds = new Set(currentRows.map((row) => row.id));
    for (const row of rows.values()) {
      const target = desired.get(row.id);
      const isDeleted = !currentIds.has(row.id);
      const deletedVersion = receipt.deletedVersions[row.id];
      if (isDeleted && !deletedVersion) throw historyError("annotation_conflict");
      const result = await tx.annotation.updateMany({
        where: { id: row.id, updatedAt: new Date(isDeleted ? deletedVersion! : row.updatedAt), deletedAt: isDeleted ? { not: null } : null },
        data: target ? {
          timestampMs: target.timestampMs,
          body: target.body,
          color: target.color,
          completedAt: target.completedAt ? new Date(target.completedAt) : null,
          completedById: target.completedById,
          deletedAt: target.deletedAt ? new Date(target.deletedAt) : null,
          rect: target.rect === null ? Prisma.JsonNull : target.rect as Prisma.InputJsonValue,
          updatedAt: version
        } : { deletedAt: version, updatedAt: version }
      });
      if (result.count !== 1) throw historyError("annotation_conflict");
      if (target) {
        await tx.attachment.deleteMany({ where: { annotationId: row.id } });
        for (const attachment of target.attachments) {
          await tx.attachment.create({ data: { ...attachment, createdAt: new Date(attachment.createdAt) } });
        }
      }
    }
    const after = await capture(tx, receipt.rootId);
    return {
      id: receipt.annotationId,
      updatedAt: version.toISOString(),
      historyToken: sign({ ...receipt, desired: current, expectedHash: hash(after), deletedVersions: await deletedVersions(tx, current, after) })
    };
  });
}
