import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import path from "node:path";
import * as dotenv from "dotenv";

export async function prepareSchema(prisma: PrismaClient) {
  return prisma.$transaction(async (tx) => {
    const seriesColumns = await tx.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("MediaSeries")');
    if (!seriesColumns.length) return 0;
    if (!seriesColumns.some((column) => column.name === "nextVersionIndex")) {
      await tx.$executeRawUnsafe('ALTER TABLE "MediaSeries" ADD COLUMN "nextVersionIndex" INTEGER NOT NULL DEFAULT 0');
    }
    const mediaColumns = await tx.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("Media")');
    if (!mediaColumns.some((column) => column.name === "seriesId") || !mediaColumns.some((column) => column.name === "versionIndex")) return 0;
    const duplicateGroups = await tx.$queryRaw<Array<{ seriesId: string; versionIndex: number }>>`
      SELECT "seriesId", "versionIndex" FROM "Media" WHERE "seriesId" IS NOT NULL
      GROUP BY "seriesId", "versionIndex" HAVING COUNT(*) > 1 OR "versionIndex" < 1`;
    let repaired = 0;
    for (const group of duplicateGroups) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Media" WHERE "seriesId" = ${group.seriesId} AND "versionIndex" = ${group.versionIndex}
        ORDER BY "createdAt", "id"`;
      const maxima = await tx.$queryRaw<Array<{ maximum: number }>>`SELECT COALESCE(MAX("versionIndex"), 0) AS maximum FROM "Media" WHERE "seriesId" = ${group.seriesId}`;
      let maximum = Math.max(0, Number(maxima[0]?.maximum ?? 0));
      for (const row of rows.slice(group.versionIndex > 0 ? 1 : 0)) {
        maximum += 1;
        if (maximum > 2147483647) throw new Error("Media version index exceeds supported range");
        await tx.$executeRaw`UPDATE "Media" SET "versionIndex" = ${maximum} WHERE "id" = ${row.id}`;
        repaired += 1;
      }
    }
    await tx.$executeRawUnsafe('UPDATE "MediaSeries" SET "nextVersionIndex" = MAX("nextVersionIndex", COALESCE((SELECT MAX("versionIndex") FROM "Media" WHERE "Media"."seriesId" = "MediaSeries"."id"), 0))');
    await tx.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "Media_seriesId_versionIndex_key" ON "Media" ("seriesId", "versionIndex")');
    return repaired;
  }, { timeout: 30000 });
}

if (typeof require !== "undefined" && require.main === module) {
  const candidates = [process.env.MARKREEL_ENV_FILE, path.resolve(__dirname, "../../../.env.local"), path.resolve(__dirname, "../../../.env")];
  const envFile = candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
  if (envFile) dotenv.config({ path: envFile });
  const prisma = new PrismaClient();
  prepareSchema(prisma).then((count) => console.log(`Schema preflight complete; repaired ${count} duplicate/invalid media version indices`))
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Schema preflight failed"); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
