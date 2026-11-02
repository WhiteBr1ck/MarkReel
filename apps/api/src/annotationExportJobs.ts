import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ANNOTATION_EXPORT_LIMITS as limits, AnnotationExportError, safeExportName, type ExportInput, type ExportSnapshot, type ExportWarning } from "./annotationExport";
import { buildAnnotationExport } from "./annotationExportBuild";

export type AnnotationExportJob = {
  id: string;
  principal: string;
  mediaId: string;
  format: "xlsx" | "zip";
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  phase: string;
  completed: number;
  total: number;
  warnings: ExportWarning[];
  error?: string;
  filename: string;
  createdAt: number;
  expiresAt: number;
  bytes?: number;
  output?: string;
  directory?: string;
  controller: AbortController;
  settled?: Promise<void>;
};

export function serializeAnnotationExport(job: AnnotationExportJob) {
  return { id: job.id, mediaId: job.mediaId, format: job.format, state: job.state, phase: job.phase,
    completed: job.completed, total: job.total, warnings: job.warnings, error: job.error,
    filename: job.filename, bytes: job.bytes, expiresAt: new Date(job.expiresAt).toISOString() };
}

export class AnnotationExportJobs {
  private readonly jobs = new Map<string, AnnotationExportJob>();
  private readonly sweep = setInterval(() => { void this.expire(); }, 30000);

  constructor() {
    this.sweep.unref();
    void this.removeAbandonedDirectories();
  }

  private async removeAbandonedDirectories() {
    const entries = await readdir(os.tmpdir(), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("markreel-annotation-export-")) continue;
      const directory = path.join(os.tmpdir(), entry.name);
      const metadata = await stat(directory).catch(() => null);
      // Live tasks and retained results expire well before this crash-recovery threshold.
      if (metadata && metadata.mtimeMs < Date.now() - 60 * 60 * 1000) await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }

  async create(principal: string, snapshot: ExportSnapshot, input: ExportInput) {
    await this.expire();
    const active = [...this.jobs.values()].filter((job) => job.state === "queued" || job.state === "running");
    if (active.length >= limits.activeJobs || active.filter((job) => job.principal === principal).length >= limits.jobsPerPrincipal
      || this.jobs.size >= limits.retainedJobs) throw new AnnotationExportError("export_limit_reached", 429);
    const createdAt = Date.now();
    const job: AnnotationExportJob = {
      id: randomUUID(), principal, mediaId: snapshot.media.id, format: input.format,
      state: "queued", phase: "queued", completed: 0, total: 0, warnings: [],
      filename: `${safeExportName(snapshot.media.title, "annotations").slice(0, 70)}-V${snapshot.media.versionIndex}.${input.format}`,
      createdAt, expiresAt: createdAt + limits.ttlMs, controller: new AbortController()
    };
    this.jobs.set(job.id, job);
    job.settled = this.run(job, snapshot, input);
    return job;
  }

  private async run(job: AnnotationExportJob, snapshot: ExportSnapshot, input: ExportInput) {
    const timeout = setTimeout(() => { job.error = "export_timeout"; job.controller.abort(); }, limits.jobTimeoutMs);
    timeout.unref();
    try {
      job.directory = await mkdtemp(path.join(os.tmpdir(), "markreel-annotation-export-"));
      if (job.controller.signal.aborted) throw new AnnotationExportError("export_cancelled");
      job.state = "running";
      job.output = await buildAnnotationExport(snapshot, input, {
        directory: job.directory, signal: job.controller.signal, warnings: job.warnings,
        progress: (completed, total, phase) => { job.completed = completed; job.total = total; job.phase = phase; }
      });
      if (job.controller.signal.aborted) throw new AnnotationExportError("export_cancelled");
      job.bytes = (await stat(job.output)).size;
      job.state = "completed";
      job.phase = "completed";
      job.expiresAt = Date.now() + limits.ttlMs;
    } catch (error) {
      job.error ??= error instanceof AnnotationExportError ? error.code : "export_failed";
      job.state = job.controller.signal.aborted && job.error !== "export_timeout" ? "cancelled" : "failed";
      job.phase = job.state;
      job.output = undefined;
    } finally {
      clearTimeout(timeout);
      if (job.directory) {
        // Keep only the downloadable result, not the original video or staging images.
        for (const file of await readdir(job.directory).catch(() => [])) {
          const filePath = path.join(job.directory, file);
          if (filePath !== job.output) await rm(filePath, { force: true }).catch(() => {});
        }
        if (!job.output) await rm(job.directory, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  async find(id: string, principal: string, mediaId: string) {
    await this.expire();
    const job = this.jobs.get(id);
    return job?.principal === principal && job.mediaId === mediaId ? job : null;
  }

  async cancel(job: AnnotationExportJob) {
    job.error = "export_cancelled";
    job.controller.abort();
    await job.settled;
    job.state = "cancelled";
    job.phase = "cancelled";
    job.output = undefined;
    if (job.directory) await rm(job.directory, { recursive: true, force: true }).catch(() => {});
  }

  private async expire() {
    for (const [id, job] of this.jobs) {
      if (job.expiresAt > Date.now()) continue;
      this.jobs.delete(id);
      await this.cancel(job);
    }
  }

  async close() {
    clearInterval(this.sweep);
    await Promise.all([...this.jobs.values()].map((job) => this.cancel(job)));
    this.jobs.clear();
  }
}
