export type Id = string;

export type ProjectRole = "owner" | "editor" | "viewer";

export type ReviewStatus = "open" | "needs_changes" | "approved";

export type MediaProcessingStatus =
  | "uploaded"
  | "queued"
  | "processing"
  | "ready"
  | "failed";

export type AnnotationType = "pin" | "rect" | "text";

export type NormalizedRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type AnnotationAttachment = {
  id: Id;
  kind: "image";
  objectKey: string;
  url?: string;
  width?: number;
  height?: number;
};

export type Annotation = {
  id: Id;
  projectId: Id;
  mediaId: Id;
  authorId: Id;
  timestampMs: number;
  type: AnnotationType;
  rect?: NormalizedRect;
  body: string;
  attachments: AnnotationAttachment[];
  createdAt: string;
  updatedAt: string;
};
