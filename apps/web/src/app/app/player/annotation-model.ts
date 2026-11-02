export type AnnotationAttachment = {
  id?: string;
  annotationId?: string;
  kind: "image";
  objectKey: string;
  mimeType?: string;
  width?: number;
  height?: number;
  createdAt?: string;
  previewUrl?: string;
};

export type AnnotationRecord = {
  id: string;
  parentId?: string | null;
  timestampMs: number;
  type: "pin" | "rect" | "text";
  body: string;
  color?: string | null;
  completedAt?: string | null;
  completedById?: string | null;
  completedBy?: AnnotationAuthor | null;
  createdAt: string;
  updatedAt: string;
  author?: AnnotationAuthor;
  attachments: AnnotationAttachment[];
  replies?: AnnotationRecord[];
};

type AnnotationAuthor = { id: string; username: string; displayName: string | null; avatarUrl?: string | null; avatarPreset?: string | null };

export const ANNOTATION_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];

export function annotationProgress(annotations: Pick<AnnotationRecord, "parentId" | "completedAt">[]) {
  const roots = annotations.filter((item) => !item.parentId);
  return { completed: roots.filter((item) => item.completedAt).length, total: roots.length };
}

export function filterAnnotations<T extends Pick<AnnotationRecord, "parentId" | "completedAt">>(annotations: T[], status: "all" | "completed" | "incomplete") {
  return annotations.filter((item) => !item.parentId && (status === "all" || Boolean(item.completedAt) === (status === "completed")));
}
