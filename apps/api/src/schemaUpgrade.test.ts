import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { prepareSchema } from "../scripts/prepare-schema";

test("schema preflight preserves media IDs while repairing legacy duplicate version indices", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "markreel-schema-"));
  const database = path.join(dir, "test.db");
  await writeFile(database, "");
  const prisma = new PrismaClient({ datasourceUrl: `file:${database.replace(/\\/g, "/")}` });
  try {
    await prisma.$executeRawUnsafe('CREATE TABLE "MediaSeries" ("id" TEXT PRIMARY KEY)');
    await prisma.$executeRawUnsafe('CREATE TABLE "Media" ("id" TEXT PRIMARY KEY, "seriesId" TEXT, "versionIndex" INTEGER NOT NULL, "createdAt" INTEGER)');
    await prisma.$executeRawUnsafe("INSERT INTO MediaSeries VALUES ('s1')");
    await prisma.$executeRawUnsafe("INSERT INTO Media VALUES ('old', 's1', 1, 1), ('duplicate', 's1', 1, 2), ('last', 's1', 5, 3), ('invalid', 's1', 0, 4), ('standalone', NULL, 1, 5)");
    assert.equal(await prepareSchema(prisma), 2);
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; versionIndex: number }>>('SELECT id, versionIndex FROM Media ORDER BY id');
    assert.equal(rows.length, 5);
    assert.equal(rows.find((row) => row.id === "old")?.versionIndex, 1);
    assert.equal(rows.find((row) => row.id === "last")?.versionIndex, 5);
    assert.equal(rows.find((row) => row.id === "standalone")?.versionIndex, 1);
    assert.equal(new Set(rows.filter((row) => row.id !== "standalone").map((row) => row.versionIndex)).size, 4);
    const counters = await prisma.$queryRawUnsafe<Array<{ nextVersionIndex: number }>>('SELECT nextVersionIndex FROM MediaSeries');
    assert.equal(Number(counters[0].nextVersionIndex), 7);
    assert.equal(await prepareSchema(prisma), 0);
    await assert.rejects(prisma.$executeRawUnsafe("INSERT INTO Media VALUES ('blocked', 's1', 1, 6)"));
  } finally { await prisma.$disconnect(); await rm(dir, { recursive: true, force: true }); }
});
