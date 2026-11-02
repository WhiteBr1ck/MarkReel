import path from "node:path";
import { ZipArchive } from "archiver";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/requireUser";

export async function integrationRoutes(app: FastifyInstance) {
  app.get("/integrations/markreel-skill.zip", { preHandler: requireUser }, async (_req, reply) => {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const root = path.resolve(__dirname, "../../../../skills/markreel");
    for (const file of ["SKILL.md", "agents/openai.yaml", "scripts/upload.py"]) archive.file(path.join(root, file), { name: `markreel/${file}` });
    archive.on("error", (error) => archive.destroy(error));
    reply.raw.once("close", () => { if (!reply.raw.writableEnded) archive.abort(); });
    reply.header("content-type", "application/zip").header("content-disposition", 'attachment; filename="markreel-skill.zip"');
    void archive.finalize().catch((error: unknown) => archive.destroy(error instanceof Error ? error : new Error("Skill archive failed")));
    return reply.send(archive);
  });
}
