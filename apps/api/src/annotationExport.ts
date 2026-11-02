import { z } from "zod";

export const ANNOTATION_EXPORT_LIMITS = {
  rows: 200,
  annotations: 2000,
  attachments: 300,
  attachmentBytes: 20 * 1024 * 1024,
  attachmentTotalBytes: 128 * 1024 * 1024,
  embeddedBytes: 48 * 1024 * 1024,
  outputBytes: 160 * 1024 * 1024,
  activeJobs: 4,
  jobsPerPrincipal: 2,
  retainedJobs: 16,
  jobTimeoutMs: 5 * 60 * 1000,
  ttlMs: 10 * 60 * 1000,
  frameConcurrency: 2,
  frameCacheBytes: 24 * 1024 * 1024,
  frameCacheTtlMs: 5 * 60 * 1000
} as const;

export const AnnotationExportInput = z.object({
  format: z.enum(["xlsx", "zip"]),
  annotationId: z.string().trim().min(1).max(128).optional(),
  status: z.enum(["all", "completed", "incomplete"]).default("all")
}).strict();

export type ExportInput = z.infer<typeof AnnotationExportInput>;
export type ExportWarning = { annotationId?: string; attachmentId?: string; code: string };
export type ExportAttachment = {
  id: string;
  annotationId: string;
  objectKey: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
};
export type ExportAnnotation = {
  id: string;
  parentId: string | null;
  timestampMs: number;
  body: string;
  completedAt: Date | null;
  createdAt: Date;
  author: { username: string; displayName: string | null };
  attachments: ExportAttachment[];
};
export type ExportMedia = {
  id: string;
  title: string;
  versionIndex: number;
  file: { id: string; originalObjectKey: string; sizeBytes: bigint | null; durationMs: number | null; createdAt: Date } | null;
};
export type ExportSnapshot = { media: ExportMedia; annotations: ExportAnnotation[] };

export class AnnotationExportError extends Error {
  constructor(readonly code: string, readonly statusCode = 422) { super(code); }
}

export function assertNotCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new AnnotationExportError("export_cancelled", 409);
}

export function exportTimecode(timestampMs: number) {
  const ms = Math.max(0, Math.trunc(timestampMs));
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

export function safeExportName(value: string, fallback = "attachment") {
  const clean = value.normalize("NFKC").replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 100).trim();
  if (!clean || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean)) return fallback;
  return clean;
}

export function attachmentExportName(attachment: ExportAttachment, index: number) {
  const basename = attachment.objectKey.split(/[\\/]/).pop() ?? "image";
  return `${String(index + 1).padStart(4, "0")}_${safeExportName(attachment.id)}_${safeExportName(basename, "image")}`;
}

export function exportDisposition(name: string) {
  const safe = safeExportName(name, "export");
  return `attachment; filename="${safe.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(safe).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

export function exportCellText(value: string) {
  // Always assign a string, never ExcelJS formula or hyperlink objects.
  let text = value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, "").slice(0, 32760);
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  return /^[\s\uFEFF]*[=+@-]/.test(text) ? `'${text}` : text;
}

export function threadAnnotations(annotations: ExportAnnotation[]) {
  const byId = new Map(annotations.map((annotation) => [annotation.id, annotation]));
  const groups = new Map<string, ExportAnnotation[]>();
  for (const annotation of annotations) {
    let root = annotation;
    const visited = new Set<string>();
    while (root.parentId && byId.has(root.parentId) && !visited.has(root.id)) {
      visited.add(root.id);
      root = byId.get(root.parentId)!;
    }
    if (root.parentId) continue;
    const group = groups.get(root.id) ?? [];
    group.push(annotation);
    groups.set(root.id, group);
  }
  return annotations.filter((annotation) => !annotation.parentId).map((root) => ({
    root,
    replies: (groups.get(root.id) ?? []).filter((annotation) => annotation.id !== root.id)
  }));
}
