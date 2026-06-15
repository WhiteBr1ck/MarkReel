"use client";

import Avatar from "boring-avatars";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBrush,
  IconCheck,
  IconCircle,
  IconClock,
  IconCopy,
  IconDownload,
  IconEdit,
  IconExternalLink,
  IconFileText,
  IconHash,
  IconHourglass,
  IconKeyboard,
  IconLetterT,
  IconMaximize,
  IconMessageReply,
  IconMinimize,
  IconPhotoPlus,
  IconPinned,
  IconPinnedOff,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconRectangle,
  IconTableExport,
  IconTrash,
  IconVolume,
  IconVolume2,
  IconVolumeOff,
  type IconProps
} from "@tabler/icons-react";
import type { CSSProperties, ChangeEvent, ClipboardEvent, PointerEvent as ReactPointerEvent, ReactNode, WheelEvent } from "react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Dialog } from "../_components/dialog";
import { api } from "../_components/api";
import { useTheme } from "../_components/theme";

type MediaDetail = {
  id: string;
  projectId: string;
  folderId: string | null;
  organizationId?: string | null;
  title: string;
  status: string;
  reviewStatus: string;
  capabilities?: string[];
  projectCapabilities?: string[];
  myRating: number | null;
  averageRating: number | null;
  ratingCount: number;
  versionIndex: number;
  seriesId: string | null;
  createdAt: string;
  updatedAt: string;
  creator?: {
    id: string;
    username: string;
    displayName: string | null;
  } | null;
  files: Array<{
    id: string;
    originalObjectKey: string;
    derivedPrefix: string | null;
    mode: string;
    durationMs: number | null;
    width: number | null;
    height: number | null;
    sizeBytes: number | null;
    bitrateKbps: number | null;
    frameCount: number | null;
    createdAt: string;
  }>;
  previewUrl?: string;
};

type PreviewResponse = {
  preview: {
    url: string;
    fileName: string;
    inline: boolean;
  };
};

type AnnotationAttachment = {
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

type AnnotationRecord = {
  id: string;
  parentId?: string | null;
  timestampMs: number;
  type: "pin" | "rect" | "text";
  body: string;
  color?: string | null;
  completedAt?: string | null;
  completedById?: string | null;
  completedBy?: { id: string; username: string; displayName: string | null; avatarUrl?: string | null; avatarPreset?: string | null } | null;
  createdAt: string;
  updatedAt: string;
  author?: { id: string; username: string; displayName: string | null; avatarUrl?: string | null; avatarPreset?: string | null };
  attachments: AnnotationAttachment[];
  replies?: AnnotationRecord[];
};

type MediaResponse = { media: MediaDetail };
type AnnotationListResponse = { annotations: AnnotationRecord[] };
type AttachmentPresignResponse = {
  upload: {
    method: "PUT";
    url: string;
    proxyUrl?: string | null;
    objectKey: string;
    bucket: string;
  };
};
type AttachmentPreviewResponse = {
  preview: {
    url: string;
    attachmentId: string;
    objectKey: string;
  };
};

type ShareMediaResponse = { share: { id: string; permissions: Array<"view" | "annotate" | "comment">; expiresAt: string | null }; media: MediaDetail };

type SidebarTab = "file" | "annotations";
type AnnotationStatusFilter = "all" | "completed" | "incomplete";
type TimeDisplayMode = "elapsed_total" | "remaining_total" | "frame";
type AnnotationExportRow = {
  id: string;
  parentId: string | null;
  timestampMs: number;
  type: AnnotationRecord["type"];
  status: "completed" | "open";
  author: string;
  body: string;
  createdAt: string;
  isReply: boolean;
};
type PendingImage = AnnotationAttachment & { localUrl?: string };
const MARKUP_ATTACHMENT_PREFIX = "attachments/markup/";
type DraftMode = "edit" | "reply";
type UploadTarget = "composer" | "draft";
type MarkupTool = "brush" | "text" | "rect" | "circle";
type MarkupPoint = { x: number; y: number };
type MarkupOperation =
  | { kind: "brush"; color: string; width: number; points: MarkupPoint[] }
  | { kind: "rect"; color: string; width: number; start: MarkupPoint; end: MarkupPoint }
  | { kind: "circle"; color: string; width: number; start: MarkupPoint; end: MarkupPoint }
  | { kind: "text"; color: string; width: number; point: MarkupPoint; text: string };
type MarkupTextDraft = { x: number; y: number; value: string } | null;

const COLOR_PRESETS = ["#c96442", "#d7a55a", "#5f8f64", "#5f85d6", "#9a68d8", "#d55f8d"];
const AVATAR_COLORS = ["#27201c", "#c96442", "#e5b56d", "#6f7f68", "#f2eadb"];
const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const TIME_DISPLAY_OPTIONS: Array<{ value: TimeDisplayMode; label: string; description: string }> = [
  { value: "elapsed_total", label: "当前 / 总时长", description: "显示当前播放时间与总时长，例如 01:23/10:00。" },
  { value: "remaining_total", label: "剩余 / 总时长", description: "显示剩余时长与总时长，例如 -08:37/10:00。" },
  { value: "frame", label: "当前帧 / 总帧", description: "按当前帧数显示，适合逐帧审阅。" }
];
const UI_HIDE_DELAY_MS = 2000;
const ICON_STROKE = 1.75;

function PlayerIcon({ icon: Icon }: { icon: React.ComponentType<IconProps> }) {
  return <Icon className="mr-player-page__icon-glyph" size={18} stroke={ICON_STROKE} aria-hidden="true" />;
}

function volumeIcon(volumeValue: number, isMuted: boolean) {
  if (isMuted || volumeValue === 0) return IconVolumeOff;
  if (volumeValue < 0.5) return IconVolume2;
  return IconVolume;
}

function timeDisplayIcon(mode: TimeDisplayMode) {
  if (mode === "frame") return IconHash;
  if (mode === "remaining_total") return IconHourglass;
  return IconClock;
}

function markupToolIcon(tool: MarkupTool) {
  if (tool === "text") return IconLetterT;
  if (tool === "rect") return IconRectangle;
  if (tool === "circle") return IconCircle;
  return IconBrush;
}

function uploadToPresignedUrl(url: string, file: File) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`upload_failed:${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("upload_failed:network"));
    xhr.send(file);
  });
}

async function uploadAttachmentFile(upload: AttachmentPresignResponse["upload"], file: File) {
  await uploadToPresignedUrl(upload.proxyUrl ?? upload.url, file);
}

function isInterruptedPlayError(error: unknown) {
  const err = error as { name?: string; message?: string };
  return err?.name === "AbortError";
}

async function safePlayVideo(video: HTMLVideoElement) {
  try {
    await video.play();
  } catch (error) {
    if (isInterruptedPlayError(error)) return;
    throw error;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function colorWithAlpha(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return hex;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function UserAvatar({
  src,
  preset,
  name = "markreel",
  className = "",
  alt = "用户头像"
}: {
  src?: string | null;
  preset?: string | null;
  name?: string;
  className?: string;
  alt?: string;
}) {
  if (src) return <img className={`mr-user-avatar${className ? ` ${className}` : ""}`} src={src} alt={alt} />;
  return (
    <span className={`mr-default-avatar${className ? ` ${className}` : ""}`} aria-label={alt}>
      <Avatar name={preset || name} colors={AVATAR_COLORS} variant="beam" size={34} square />
    </span>
  );
}

function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "00:00";
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function toPath(url: URL) {
  return `${url.pathname}${url.search}${url.hash}` || "/app";
}

function getWorkbenchBackHref() {
  if (typeof window === "undefined") return "/app";
  const saved = window.localStorage.getItem("mr_last_workbench_url");
  if (!saved) return "/app";
  try {
    const url = new URL(saved, window.location.origin);
    if (!url.pathname.startsWith("/app") || url.pathname.startsWith("/app/player")) return "/app";
    return toPath(url);
  } catch {
    return "/app";
  }
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN");
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  const fixed = u === 0 ? 0 : n >= 10 ? 1 : 2;
  return `${n.toFixed(fixed)} ${units[u]}`;
}

function formatDuration(seconds?: number) {
  if (!seconds && seconds !== 0) return "-";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function formatSpeed(speed: number) {
  return `${speed.toFixed(speed % 1 === 0 ? 0 : speed * 10 % 10 === 0 ? 1 : 2)}x`;
}

function toZhError(e: any): string {
  const code = e?.data?.error as string | undefined;
  if (!code) {
    if (e?.status === 500) return "服务器内部错误（请查看 API 控制台日志）";
    return "请求失败";
  }
  const map: Record<string, string> = {
    unauthorized: "未登录或登录已过期",
    database_unavailable: "数据库不可用，请先启动 API 的 SQLite/Prisma 链路",
    object_storage_unavailable: "对象存储不可用，请先启动 MinIO / S3 本地服务。",
    preview_not_ready: "该视频还在处理中，暂时还不能预览。",
    not_found: "未找到对应素材"
  };
  return map[code] ?? code;
}

function formatTimecodeMs(timestampMs: number) {
  return formatClock(timestampMs / 1000);
}

function annotationAuthorName(annotation: AnnotationRecord) {
  return annotation.author?.displayName?.trim() || annotation.author?.username || "访客";
}

function flattenAnnotationsForExport(annotations: AnnotationRecord[]): AnnotationExportRow[] {
  return annotations.flatMap((annotation) => {
    const rows: AnnotationExportRow[] = [
      {
        id: annotation.id,
        parentId: annotation.parentId ?? null,
        timestampMs: annotation.timestampMs,
        type: annotation.type,
        status: annotation.completedAt ? "completed" : "open",
        author: annotationAuthorName(annotation),
        body: annotation.body || "（仅画面标注）",
        createdAt: annotation.createdAt,
        isReply: Boolean(annotation.parentId)
      }
    ];
    for (const reply of annotation.replies ?? []) {
      rows.push({
        id: reply.id,
        parentId: reply.parentId ?? annotation.id,
        timestampMs: reply.timestampMs,
        type: reply.type,
        status: reply.completedAt ? "completed" : "open",
        author: annotationAuthorName(reply),
        body: reply.body || "（空回复）",
        createdAt: reply.createdAt,
        isReply: true
      });
    }
    return rows;
  });
}

function buildAnnotationTextExport(title: string, annotations: AnnotationRecord[]) {
  const lines = [`${title} 标注导出`, ""];
  annotations.forEach((annotation, index) => {
    lines.push(`${index + 1}. ${formatTimecodeMs(annotation.timestampMs)} ${annotationAuthorName(annotation)} ${annotation.completedAt ? "已完成" : "未完成"}`);
    lines.push(annotation.body || "（仅画面标注）");
    for (const reply of annotation.replies ?? []) {
      lines.push(`  回复 ${formatTimecodeMs(reply.timestampMs)} ${annotationAuthorName(reply)}：${reply.body || "（空回复）"}`);
    }
    lines.push("");
  });
  return lines.join("\n").trimEnd() + "\n";
}

function escapeCsvCell(value: string | number | null) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildAnnotationCsvExport(annotations: AnnotationRecord[]) {
  const rows = flattenAnnotationsForExport(annotations);
  const header = ["timecode", "timestamp_ms", "type", "status", "author", "body", "parent_id", "created_at"];
  return [
    header.map(escapeCsvCell).join(","),
    ...rows.map((row) => [
      formatTimecodeMs(row.timestampMs),
      row.timestampMs,
      row.isReply ? "reply" : row.type,
      row.status,
      row.author,
      row.body,
      row.parentId,
      row.createdAt
    ].map(escapeCsvCell).join(","))
  ].join("\n") + "\n";
}

function chapterTitle(annotation: AnnotationRecord, index: number) {
  const firstLine = annotation.body.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!firstLine) return `标注 ${index + 1}`;
  return firstLine.length > 48 ? `${firstLine.slice(0, 48)}...` : firstLine;
}

function buildChapterTextExport(annotations: AnnotationRecord[]) {
  return annotations
    .map((annotation, index) => `${formatTimecodeMs(annotation.timestampMs)} ${chapterTitle(annotation, index)}`)
    .join("\n") + "\n";
}

function safeExportFileName(title: string, extension: string) {
  const base = title.trim().replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "markreel-annotations";
  return `${base}.${extension}`;
}

function downloadTextFile(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function canMedia(media: MediaDetail | null | undefined, capability: string) {
  return !!media?.capabilities?.includes(capability);
}

function normalizeMedia(media: MediaDetail): MediaDetail {
  return { ...media, files: Array.isArray(media.files) ? media.files : [] };
}

function getImageSize(file: File) {
  return new Promise<{ width?: number; height?: number }>((resolve) => {
    if (!file.type.startsWith("image/")) {
      resolve({});
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({});
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

async function fileToPendingImage(file: File): Promise<PendingImage> {
  const imageSize = await getImageSize(file);
  const localUrl = URL.createObjectURL(file);
  return {
    kind: "image",
    objectKey: "",
    mimeType: file.type || undefined,
    ...imageSize,
    localUrl,
    previewUrl: localUrl
  };
}

function mergePreviewUrls(items: AnnotationRecord[], map: Record<string, string>) {
  return items.map((annotation) => ({
    ...annotation,
    attachments: annotation.attachments.map((attachment) => ({
      ...attachment,
      previewUrl: attachment.id ? map[attachment.id] ?? attachment.previewUrl : attachment.previewUrl
    })),
    replies: annotation.replies?.map((reply) => ({
      ...reply,
      attachments: reply.attachments.map((attachment) => ({
        ...attachment,
        previewUrl: attachment.id ? map[attachment.id] ?? attachment.previewUrl : attachment.previewUrl
      }))
    }))
  }));
}

function clonePendingImages(items: AnnotationAttachment[]): PendingImage[] {
  return items.map((item) => ({ ...item }));
}

function releasePendingImages(items: PendingImage[]) {
  items.forEach((item) => {
    if (item.localUrl) URL.revokeObjectURL(item.localUrl);
  });
}

function toAttachmentPayload(items: PendingImage[]) {
  return items
    .filter((item) => item.objectKey)
    .map((item) => ({
      kind: item.kind,
      objectKey: item.objectKey,
      mimeType: item.mimeType,
      width: item.width,
      height: item.height
    }));
}

function drawMarkupOperation(ctx: CanvasRenderingContext2D, operation: MarkupOperation, width: number, height: number) {
  ctx.save();
  ctx.strokeStyle = operation.color;
  ctx.fillStyle = operation.color;
  ctx.lineWidth = operation.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (operation.kind === "brush") {
    if (operation.points.length === 0) {
      ctx.restore();
      return;
    }
    ctx.beginPath();
    operation.points.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  } else if (operation.kind === "rect") {
    const x = operation.start.x * width;
    const y = operation.start.y * height;
    const w = (operation.end.x - operation.start.x) * width;
    const h = (operation.end.y - operation.start.y) * height;
    ctx.strokeRect(x, y, w, h);
  } else if (operation.kind === "circle") {
    const x1 = operation.start.x * width;
    const y1 = operation.start.y * height;
    const x2 = operation.end.x * width;
    const y2 = operation.end.y * height;
    ctx.beginPath();
    ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.font = `${Math.max(16, operation.width * 7)}px Arial, sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(operation.text, operation.point.x * width, operation.point.y * height);
  }

  ctx.restore();
}

function renderMarkupOperations(canvas: HTMLCanvasElement, operations: MarkupOperation[], preview?: MarkupOperation | null) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.clearRect(0, 0, width, height);
  operations.forEach((operation) => drawMarkupOperation(ctx, operation, width, height));
  if (preview) drawMarkupOperation(ctx, preview, width, height);
}

function canvasToFile(canvas: HTMLCanvasElement, filename: string) {
  return new Promise<File>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("canvas_export_failed"));
        return;
      }
      resolve(new File([blob], filename, { type: blob.type || "image/png" }));
    }, "image/png");
  });
}

function getPointerPoint(event: ReactPointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
  };
}

function getReplyPrefix(annotation: AnnotationRecord) {
  return `回复@${annotation.author?.displayName ?? annotation.author?.username ?? "admin"}：`;
}

function IconButton({ title, onClick, children, active = false, disabled = false }: { title: string; onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void; children: ReactNode; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={`mr-player-page__icon-btn${active ? " mr-player-page__icon-btn--active" : ""}`}
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function PlayerPageInner() {
  useTheme();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mediaId = searchParams.get("mid") ?? "";
  const shareToken = searchParams.get("share") ?? "";
  const isShareMode = !!shareToken;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoShellRef = useRef<HTMLDivElement | null>(null);
  const markupCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const exportCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const uiHideTimerRef = useRef<number | null>(null);
  const fastSeekTimerRef = useRef<number | null>(null);
  const fastSeekPreviousRateRef = useRef<number | null>(null);
  const [media, setMedia] = useState<MediaDetail | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [annotationLoading, setAnnotationLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("annotations");
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [composerBody, setComposerBody] = useState("");
  const [composerColor, setComposerColor] = useState(COLOR_PRESETS[0]!);
  const [composerAttachments, setComposerAttachments] = useState<PendingImage[]>([]);
  const [composerSubmitting, setComposerSubmitting] = useState(false);
  const [composerUploading, setComposerUploading] = useState(false);
  const [draftMode, setDraftMode] = useState<DraftMode | null>(null);
  const [draftTargetId, setDraftTargetId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [draftColor, setDraftColor] = useState(COLOR_PRESETS[0]!);
  const [draftAttachments, setDraftAttachments] = useState<PendingImage[]>([]);
  const [draftSubmitting, setDraftSubmitting] = useState(false);
  const [draftUploading, setDraftUploading] = useState(false);
  const [attachmentInputTarget, setAttachmentInputTarget] = useState<UploadTarget>("composer");
  const [deleteTarget, setDeleteTarget] = useState<AnnotationRecord | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [customSpeed, setCustomSpeed] = useState("1");
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showShortcutDialog, setShowShortcutDialog] = useState(false);
  const [showTimeDisplayMenu, setShowTimeDisplayMenu] = useState(false);
  const [timeDisplayMode, setTimeDisplayMode] = useState<TimeDisplayMode>("elapsed_total");
  const [annotationEditorFullscreen, setAnnotationEditorFullscreen] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [showUi, setShowUi] = useState(true);
  const [pinUi, setPinUi] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number>(0);
  const [statusFilter, setStatusFilter] = useState<AnnotationStatusFilter>("all");
  const [draftRating, setDraftRating] = useState<number>(0);
  const [savingRating, setSavingRating] = useState(false);
  const [attachmentModal, setAttachmentModal] = useState<{ url: string; zoom: number; offsetX: number; offsetY: number; dragging: boolean; dragOriginX: number; dragOriginY: number } | null>(null);
  const [markupEditorOpen, setMarkupEditorOpen] = useState(false);
  const [markupTool, setMarkupTool] = useState<MarkupTool>("brush");
  const [markupColor, setMarkupColor] = useState(COLOR_PRESETS[0]!);
  const [markupOpacity, setMarkupOpacity] = useState(1);
  const [markupWidth, setMarkupWidth] = useState(5);
  const [markupOperations, setMarkupOperations] = useState<MarkupOperation[]>([]);
  const [markupPreview, setMarkupPreview] = useState<MarkupOperation | null>(null);
  const [markupTextDraft, setMarkupTextDraft] = useState<MarkupTextDraft>(null);
  const [markupSaving, setMarkupSaving] = useState(false);
  const [selectedMarkupAnnotationId, setSelectedMarkupAnnotationId] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const activeMarkupRef = useRef<MarkupOperation | null>(null);
  const clickTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isShareMode) {
      setIsLoggedIn(true);
      return;
    }
    let cancelled = false;
    void api<{ user: unknown }>("/me")
      .then(() => {
        if (!cancelled) setIsLoggedIn(true);
      })
      .catch(() => {
        if (!cancelled) setIsLoggedIn(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isShareMode]);

  function playerApiPath(path: string) {
    if (!isShareMode) return path;
    if (path === "/attachments/presign") return `/share/${shareToken}/attachments/presign`;
    if (path.startsWith("/media/") && path.endsWith("/annotations")) return `/share/${shareToken}/annotations`;
    if (path.startsWith("/media/") && path.includes("/annotations?")) {
      const query = path.slice(path.indexOf("?"));
      return `/share/${shareToken}/annotations${query}`;
    }
    if (path.startsWith("/annotations/") && path.endsWith("/completion")) {
      const annotationId = path.slice("/annotations/".length, -"/completion".length);
      return `/share/${shareToken}/annotations/${annotationId}/completion`;
    }
    if (path.startsWith("/annotations/")) {
      const annotationId = path.slice("/annotations/".length);
      return `/share/${shareToken}/annotations/${annotationId}`;
    }
    return path;
  }

  async function playerApi<T>(path: string, init?: RequestInit): Promise<T> {
    return api<T>(playerApiPath(path), init);
  }

  useEffect(() => {
    if (!mediaId && !isShareMode) {
      setMedia(null);
      setPreviewUrl("");
      setDraftRating(0);
      setDuration(0);
      setError("未找到对应素材");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const loader = isShareMode
      ? api<ShareMediaResponse>(`/share/${shareToken}/media`).then((data) => ({ media: data.media, previewUrl: data.media.previewUrl ?? `/api/share/${shareToken}/media/file` }))
      : Promise.all([api<MediaResponse>(`/media/${mediaId}`), api<PreviewResponse>(`/media/${mediaId}/preview`)]).then(([mediaData]) => ({ media: mediaData.media, previewUrl: `/api/media/${mediaId}/preview/file` }));
    loader
      .then((mediaData) => {
        if (cancelled) return;
        const normalized = normalizeMedia(mediaData.media);
        setMedia(normalized);
        setPreviewUrl(mediaData.previewUrl);
        setDraftRating(normalized.myRating ?? 0);
        const file = normalized.files[0];
        setDuration(file?.durationMs ? file.durationMs / 1000 : 0);
      })
      .catch((e) => {
        if (cancelled) return;
        if (!isShareMode && e?.status === 401) {
          router.replace("/app");
          return;
        }
        setError(toZhError(e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isShareMode, mediaId, shareToken]);

  async function hydrateAttachmentPreviewUrls(list: AnnotationRecord[]) {
    const attachmentsToLoad = list.flatMap((annotation) => [
      ...annotation.attachments
        .filter((attachment) => attachment.id && !attachment.previewUrl)
        .map((attachment) => ({ annotationId: annotation.id, attachmentId: attachment.id! })),
      ...(annotation.replies ?? []).flatMap((reply) =>
        reply.attachments
          .filter((attachment) => attachment.id && !attachment.previewUrl)
          .map((attachment) => ({ annotationId: reply.id, attachmentId: attachment.id! }))
      )
    ]);
    if (attachmentsToLoad.length === 0) return list;
    const previews = await Promise.all(
      attachmentsToLoad.map(async ({ annotationId, attachmentId }) => {
        if (isShareMode) return [attachmentId, undefined] as const;
        const data = await api<AttachmentPreviewResponse>(`/annotations/${annotationId}/attachments/${attachmentId}/preview`);
        return [attachmentId, data.preview.url] as const;
      })
    );
    return mergePreviewUrls(list, Object.fromEntries(previews.filter(([, url]) => url)) as Record<string, string>);
  }

  async function reloadAnnotations(filter = statusFilter) {
    const query = filter === "all" ? "" : `?status=${filter}`;
    const data = await playerApi<AnnotationListResponse>(`/media/${media?.id ?? mediaId}/annotations${query}`);
    const hydrated = await hydrateAttachmentPreviewUrls(data.annotations);
    setAnnotations(hydrated);
    return hydrated;
  }

  useEffect(() => {
    if (!mediaId && !isShareMode) {
      setAnnotations([]);
      setSelectedAnnotationId(null);
      setAnnotationError(null);
      setAnnotationLoading(false);
      return;
    }
    let cancelled = false;
    setAnnotationLoading(true);
    setAnnotationError(null);
    void reloadAnnotations(statusFilter)
      .catch((e) => {
        if (cancelled) return;
        setAnnotationError(toZhError(e));
        setAnnotations([]);
      })
      .finally(() => {
        if (cancelled) return;
        setAnnotationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isShareMode, media?.id, mediaId, statusFilter, shareToken]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const currentVideo = video;
    function syncTime() {
      setCurrentTime(currentVideo.currentTime || 0);
      if (Number.isFinite(currentVideo.duration) && currentVideo.duration > 0) setDuration(currentVideo.duration);
    }
    function syncState() {
      setIsPlaying(!currentVideo.paused && !currentVideo.ended);
      setPlaybackRate(currentVideo.playbackRate || 1);
      setVolume(currentVideo.volume);
      setMuted(currentVideo.muted || currentVideo.volume === 0);
    }
    function syncFullscreen() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    syncTime();
    syncState();
    syncFullscreen();
    currentVideo.addEventListener("timeupdate", syncTime);
    currentVideo.addEventListener("loadedmetadata", syncTime);
    currentVideo.addEventListener("durationchange", syncTime);
    currentVideo.addEventListener("play", syncState);
    currentVideo.addEventListener("pause", syncState);
    currentVideo.addEventListener("ratechange", syncState);
    currentVideo.addEventListener("volumechange", syncState);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => {
      currentVideo.pause();
      currentVideo.removeEventListener("timeupdate", syncTime);
      currentVideo.removeEventListener("loadedmetadata", syncTime);
      currentVideo.removeEventListener("durationchange", syncTime);
      currentVideo.removeEventListener("play", syncState);
      currentVideo.removeEventListener("pause", syncState);
      currentVideo.removeEventListener("ratechange", syncState);
      currentVideo.removeEventListener("volumechange", syncState);
      document.removeEventListener("fullscreenchange", syncFullscreen);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!isFullscreen) {
      setShowUi(true);
      return;
    }
    if (pinUi) {
      setShowUi(true);
      return;
    }
    scheduleUiHide();
    return () => {
      if (uiHideTimerRef.current) window.clearTimeout(uiHideTimerRef.current);
    };
  }, [isFullscreen, pinUi]);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
      releasePendingImages(composerAttachments);
      releasePendingImages(draftAttachments);
    };
  }, [composerAttachments, draftAttachments]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const inEditable = Boolean(target?.closest("input, textarea, [contenteditable='true']"));
      if (inEditable) return;
      if (event.key === " ") {
        event.preventDefault();
        void togglePlayback();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekBy(-5);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        seekBy(5);
        return;
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        void toggleFullscreen();
        return;
      }
      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        toggleMute();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentTime, isFullscreen, muted, volume, pinUi, playbackRate]);

  const filteredCount = annotations.length;
  const totalReplyCount = annotations.reduce((sum, annotation) => sum + (annotation.replies?.length ?? 0), 0);
  const mediaFiles = Array.isArray(media?.files) ? media.files : [];
  const primaryFile = mediaFiles.find((file) => file.mode === "derived") ?? mediaFiles[0] ?? null;
  const frameStepSeconds = useMemo(() => {
    if (duration > 0 && primaryFile?.frameCount && primaryFile.frameCount > 0) return duration / primaryFile.frameCount;
    return 1 / 24;
  }, [duration, primaryFile?.frameCount]);
  const currentFrame = useMemo(() => {
    if (!primaryFile?.frameCount || duration <= 0) return null;
    return clamp(Math.round(currentTime / frameStepSeconds) + 1, 1, primaryFile.frameCount);
  }, [currentTime, duration, frameStepSeconds, primaryFile?.frameCount]);
  const derivedFps = useMemo(() => {
    if (!primaryFile?.frameCount || !primaryFile.durationMs || primaryFile.durationMs <= 0) return null;
    const fps = primaryFile.frameCount / (primaryFile.durationMs / 1000);
    if (!Number.isFinite(fps) || fps <= 0) return null;
    return fps;
  }, [primaryFile?.durationMs, primaryFile?.frameCount]);
  const fpsDisplay = useMemo(() => {
    if (!derivedFps) return "未知";
    const rounded = Math.round(derivedFps * 100) / 100;
    return Number.isInteger(rounded) ? `${rounded}` : `${rounded.toFixed(2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1")}`;
  }, [derivedFps]);

  const selectedAnnotation = annotations.find((item) => item.id === selectedAnnotationId) ?? null;
  const flatAnnotations = useMemo(() => annotations.flatMap((item) => [item, ...(item.replies ?? [])]), [annotations]);
  const canAnnotate = canMedia(media, "media:annotate");
  const canManage = canMedia(media, "media:manage");
  const selectedMarkupAttachment = useMemo(() => {
    if (!selectedAnnotation || selectedMarkupAnnotationId !== selectedAnnotation.id || isPlaying || markupEditorOpen) return null;
    return selectedAnnotation.attachments.find((attachment) => attachment.previewUrl && attachment.objectKey.startsWith(MARKUP_ATTACHMENT_PREFIX)) ?? null;
  }, [isPlaying, markupEditorOpen, selectedAnnotation, selectedMarkupAnnotationId]);
  const draftTargetAnnotation = useMemo(() => flatAnnotations.find((item) => item.id === draftTargetId) ?? null, [draftTargetId, flatAnnotations]);
  const isCreateDraft = draftMode == null;
  const timeDisplayValue = useMemo(() => {
    if (timeDisplayMode === "remaining_total") return `-${formatClock(Math.max(0, duration - currentTime))}/${formatClock(duration)}`;
    if (timeDisplayMode === "frame") {
      if (!primaryFile?.frameCount || !currentFrame) return `帧 -- / ${primaryFile?.frameCount ?? "--"}`;
      return `${currentFrame}/${primaryFile.frameCount} 帧`;
    }
    return `${formatClock(currentTime)}/${formatClock(duration)}`;
  }, [currentFrame, currentTime, duration, primaryFile?.frameCount, timeDisplayMode]);
  const timelineProgress = duration > 0 ? clamp((currentTime / duration) * 100, 0, 100) : 0;

  useEffect(() => {
    const canvas = markupCanvasRef.current;
    if (!canvas) return;
    renderMarkupOperations(canvas, markupOperations, markupPreview);
  }, [isFullscreen, markupEditorOpen, markupOperations, markupPreview]);

  useEffect(() => {
    if (!isPlaying) return;
    setMarkupEditorOpen(false);
    setSelectedMarkupAnnotationId(null);
  }, [isPlaying]);

  function clearUiHideTimer() {
    if (uiHideTimerRef.current) {
      window.clearTimeout(uiHideTimerRef.current);
      uiHideTimerRef.current = null;
    }
  }

  function scheduleUiHide() {
    if (!isFullscreen || pinUi) return;
    clearUiHideTimer();
    setShowUi(true);
    uiHideTimerRef.current = window.setTimeout(() => setShowUi(false), UI_HIDE_DELAY_MS);
  }

  function revealUi() {
    if (markupEditorOpen) return;
    setShowUi(true);
    if (!isFullscreen) return;
    scheduleUiHide();
  }

  function keepUiVisible() {
    if (markupEditorOpen) return;
    clearUiHideTimer();
    setShowUi(true);
  }

  function resumeUiHide() {
    if (!isFullscreen || pinUi || markupEditorOpen) return;
    scheduleUiHide();
  }

  function hideUiNow() {
    if (!isFullscreen || pinUi) return;
    clearUiHideTimer();
    setShowUi(false);
  }

  function seekTo(seconds: number, preserveMarkupOverlay = false) {
    const video = videoRef.current;
    if (!video) return;
    if (!preserveMarkupOverlay) setSelectedMarkupAnnotationId(null);
    const next = clamp(seconds, 0, duration || video.duration || Number.MAX_SAFE_INTEGER);
    video.currentTime = next;
    setCurrentTime(next);
  }

  function seekBy(delta: number) {
    seekTo(currentTime + delta);
  }

  function stepFrame(direction: -1 | 1) {
    seekBy(frameStepSeconds * direction);
  }

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (markupEditorOpen) {
        setMarkupEditorOpen(false);
      }
      await safePlayVideo(video);
    } else {
      video.pause();
    }
  }

  async function toggleFullscreen() {
    const shell = videoShellRef.current;
    if (!shell) return;
    if (!document.fullscreenElement) {
      await shell.requestFullscreen?.();
      scheduleUiHide();
      return;
    }
    await document.exitFullscreen();
  }

  function setSpeed(speed: number) {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = speed;
    setPlaybackRate(speed);
    setCustomSpeed(String(speed));
    setShowSpeedMenu(false);
  }

  function applyCustomSpeed() {
    const next = Number(customSpeed);
    if (!Number.isFinite(next) || next <= 0 || next > 16) return;
    setSpeed(next);
  }

  function selectTimeDisplayMode(mode: TimeDisplayMode) {
    setTimeDisplayMode(mode);
    setShowTimeDisplayMenu(false);
  }

  function setVideoVolume(next: number) {
    const video = videoRef.current;
    if (!video) return;
    const normalized = clamp(next, 0, 1);
    video.volume = normalized;
    video.muted = normalized === 0;
    setVolume(normalized);
    setMuted(normalized === 0);
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    if (video.muted || video.volume === 0) {
      video.muted = false;
      if (video.volume === 0) video.volume = 0.8;
    } else {
      video.muted = true;
    }
    setMuted(video.muted);
    setVolume(video.volume);
  }

  async function uploadMarkupFile(file: File): Promise<AnnotationAttachment> {
    const imageSize = await getImageSize(file);
    const data = await playerApi<AttachmentPresignResponse>("/attachments/presign", {
      method: "POST",
      body: JSON.stringify({ filename: `markup-${file.name}`, contentType: file.type || "image/png" })
    });
    await uploadAttachmentFile(data.upload, file);
    return {
      kind: "image",
      objectKey: data.upload.objectKey,
      mimeType: file.type || "image/png",
      ...imageSize
    };
  }

  function openMarkupEditor() {
    const video = videoRef.current;
    if (video && !video.paused) video.pause();
    setMarkupEditorOpen(true);
    setShowUi(false);
  }

  function closeMarkupEditor() {
    setMarkupEditorOpen(false);
    setShowUi(true);
  }

  function toggleMarkupEditor() {
    if (markupEditorOpen) {
      closeMarkupEditor();
      return;
    }
    openMarkupEditor();
  }

  function resetMarkupDraft() {
    setMarkupOperations([]);
    setMarkupPreview(null);
    setMarkupTextDraft(null);
    activeMarkupRef.current = null;
    const canvas = markupCanvasRef.current;
    if (canvas) renderMarkupOperations(canvas, [], null);
  }

  function cancelMarkupEditor() {
    closeMarkupEditor();
    resetMarkupDraft();
  }

  function commitMarkupText() {
    const value = markupTextDraft?.value.trim();
    if (!markupTextDraft || !value) {
      setMarkupTextDraft(null);
      return;
    }
    setMarkupOperations((prev) => [
      ...prev,
      { kind: "text", color: colorWithAlpha(markupColor, markupOpacity), width: markupWidth, point: { x: markupTextDraft.x, y: markupTextDraft.y }, text: value }
    ]);
    setMarkupTextDraft(null);
  }

  function handleMarkupPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!markupEditorOpen || markupTool === "text") return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getPointerPoint(event);
    const next: MarkupOperation = markupTool === "brush"
      ? { kind: "brush", color: colorWithAlpha(markupColor, markupOpacity), width: markupWidth, points: [point] }
      : { kind: markupTool, color: colorWithAlpha(markupColor, markupOpacity), width: markupWidth, start: point, end: point };
    activeMarkupRef.current = next;
    setMarkupPreview(next);
  }

  function handleMarkupPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!markupEditorOpen || !activeMarkupRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const point = getPointerPoint(event);
    const current = activeMarkupRef.current;
    let next: MarkupOperation;
    if (current.kind === "brush") {
      next = { ...current, points: [...current.points, point] };
    } else if (current.kind === "rect" || current.kind === "circle") {
      next = { ...current, end: point };
    } else {
      return;
    }
    activeMarkupRef.current = next;
    setMarkupPreview(next);
  }

  function finishMarkupPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (!activeMarkupRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const done = activeMarkupRef.current;
    activeMarkupRef.current = null;
    setMarkupPreview(null);
    setMarkupOperations((prev) => [...prev, done]);
  }

  function handleMarkupTextClick(event: ReactPointerEvent<HTMLDivElement>) {
    if (!markupEditorOpen || markupTool !== "text") return;
    event.preventDefault();
    event.stopPropagation();
    const point = getPointerPoint(event);
    setMarkupTextDraft({ x: point.x, y: point.y, value: "" });
  }

  async function exportMarkupAttachment() {
    const video = videoRef.current;
    const exportCanvas = exportCanvasRef.current;
    if (!video || !exportCanvas || markupOperations.length === 0) return null;
    const width = video.videoWidth || primaryFile?.width || 1280;
    const height = video.videoHeight || primaryFile?.height || 720;
    exportCanvas.width = width;
    exportCanvas.height = height;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) throw new Error("canvas_context_unavailable");
    ctx.drawImage(video, 0, 0, width, height);
    markupOperations.forEach((operation) => drawMarkupOperation(ctx, operation, width, height));
    const file = await canvasToFile(exportCanvas, `markreel-markup-${Date.now()}.png`);
    return uploadMarkupFile(file);
  }

  async function saveMarkupAnnotation() {
    if (!mediaId || markupOperations.length === 0 || markupSaving) return;
    setMarkupSaving(true);
    setAnnotationError(null);
    try {
      const attachment = await exportMarkupAttachment();
      if (!attachment) return;
      await api(`/media/${mediaId}/annotations`, {
        method: "POST",
        body: JSON.stringify({
          timestampMs: Math.max(0, Math.round(currentTime * 1000)),
          type: "pin",
          body: "",
          color: composerColor,
          attachments: [attachment]
        })
      });
      const next = await reloadAnnotations();
      const createdAnnotationId = next.at(-1)?.id ?? null;
      setSelectedAnnotationId(createdAnnotationId);
      setSelectedMarkupAnnotationId(createdAnnotationId);
      setSidebarTab("annotations");
      setMarkupEditorOpen(false);
      setShowUi(true);
      resetMarkupDraft();
    } catch (e) {
      setAnnotationError(toZhError(e));
    } finally {
      setMarkupSaving(false);
    }
  }

  async function uploadFiles(files: File[], target: UploadTarget) {
    if (files.length === 0) return;
    if (target === "draft") {
      setDraftUploading(true);
    } else {
      setComposerUploading(true);
    }
    setAnnotationError(null);
    let local: PendingImage[] = [];
    try {
      local = await Promise.all(files.map((file) => fileToPendingImage(file)));
      if (target === "draft") {
        setDraftAttachments((prev) => [...prev, ...local]);
      } else {
        setComposerAttachments((prev) => [...prev, ...local]);
      }

      const uploaded = await Promise.all(
        files.map(async (file, index) => {
          const imageSize = await getImageSize(file);
          const data = await playerApi<AttachmentPresignResponse>("/attachments/presign", {
            method: "POST",
            body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream" })
          });
          await uploadAttachmentFile(data.upload, file);
          return {
            ...local[index],
            kind: "image" as const,
            objectKey: data.upload.objectKey,
            mimeType: file.type || undefined,
            ...imageSize
          };
        })
      );

      const applyUploaded = (prev: PendingImage[]) => {
        const remain = [...prev];
        local.forEach((item) => {
          const idx = remain.findIndex((candidate) => candidate.localUrl === item.localUrl);
          if (idx >= 0) remain.splice(idx, 1);
        });
        return [...remain, ...uploaded];
      };

      if (target === "draft") {
        setDraftAttachments(applyUploaded);
      } else {
        setComposerAttachments(applyUploaded);
      }
    } catch (e) {
      releasePendingImages(local);
      const cleanup = (prev: PendingImage[]) => prev.filter((candidate) => !local.some((item) => item.localUrl === candidate.localUrl));
      if (target === "draft") {
        setDraftAttachments(cleanup);
      } else {
        setComposerAttachments(cleanup);
      }
      setAnnotationError(toZhError(e));
    } finally {
      if (target === "draft") {
        setDraftUploading(false);
      } else {
        setComposerUploading(false);
      }
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    }
  }

  async function handleAttachmentInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    await uploadFiles(files, attachmentInputTarget);
  }

  async function handleEditorPaste(event: ClipboardEvent<HTMLElement>, target: UploadTarget) {
    const files = Array.from(event.clipboardData.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    await uploadFiles(files, target);
  }

  function triggerAttachmentPicker(target: UploadTarget) {
    if (!canAnnotate) return;
    setAttachmentInputTarget(target);
    attachmentInputRef.current?.click();
  }

  function removeComposerAttachment(index: number) {
    setComposerAttachments((prev) => {
      const target = prev[index];
      if (target?.localUrl) URL.revokeObjectURL(target.localUrl);
      return prev.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  function removeDraftAttachment(index: number) {
    setDraftAttachments((prev) => {
      const target = prev[index];
      if (target?.localUrl) URL.revokeObjectURL(target.localUrl);
      return prev.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  function resetComposer() {
    releasePendingImages(composerAttachments);
    setComposerBody("");
    setComposerColor(COLOR_PRESETS[0]!);
    setComposerAttachments([]);
  }

  function closeDraft() {
    releasePendingImages(draftAttachments);
    setDraftMode(null);
    setDraftTargetId(null);
    setDraftBody("");
    setDraftColor(COLOR_PRESETS[0]!);
    setDraftAttachments([]);
  }

  function cancelDraft() {
    closeDraft();
  }

  function openEditDraft(annotation: AnnotationRecord) {
    if (!canAnnotate) return;
    releasePendingImages(draftAttachments);
    setDraftMode("edit");
    setDraftTargetId(annotation.id);
    setDraftBody(annotation.body);
    setDraftColor(annotation.color || COLOR_PRESETS[0]!);
    setDraftAttachments(clonePendingImages(annotation.attachments));
    setSelectedAnnotationId(annotation.parentId ?? annotation.id);
    setSidebarTab("annotations");
    seekTo(annotation.timestampMs / 1000, true);
  }

  function selectAnnotation(annotation: AnnotationRecord, pause = true) {
    const rootId = annotation.parentId ?? annotation.id;
    setSelectedAnnotationId(rootId);
    setSelectedMarkupAnnotationId(annotation.attachments.some((attachment) => attachment.objectKey.startsWith(MARKUP_ATTACHMENT_PREFIX)) ? rootId : null);
    setSidebarTab("annotations");
    if (pause) videoRef.current?.pause();
    seekTo(annotation.timestampMs / 1000, true);
  }

  async function saveRating() {
    if (isShareMode) return;
    if (!mediaId || draftRating < 1 || draftRating > 5) return;
    setSavingRating(true);
    try {
      const response = await api<MediaResponse>(`/media/${mediaId}`, { method: "PATCH", body: JSON.stringify({ rating: draftRating }) });
      setMedia(normalizeMedia(response.media));
      setDraftRating(response.media.myRating ?? 0);
    } catch (e) {
      setAnnotationError(toZhError(e));
    } finally {
      setSavingRating(false);
    }
  }

  async function createAnnotation() {
    if (!canAnnotate) {
      setAnnotationError("这个分享链接只有查看权限");
      return;
    }
    const cleanBody = composerBody.trim();
    const hasMarkupDraft = markupOperations.length > 0;
    if (!cleanBody && composerAttachments.length === 0 && !hasMarkupDraft) return;
    const activeMediaId = media?.id ?? mediaId;
    if (!activeMediaId) {
      setAnnotationError("未找到对应素材");
      return;
    }
    setComposerSubmitting(true);
    setMarkupSaving(hasMarkupDraft);
    setAnnotationError(null);
    try {
      const markupAttachment = hasMarkupDraft ? await exportMarkupAttachment() : null;
      const attachments = [
        ...toAttachmentPayload(composerAttachments),
        ...(markupAttachment ? [markupAttachment] : [])
      ];
      await playerApi(`/media/${activeMediaId}/annotations`, {
        method: "POST",
        body: JSON.stringify({
          timestampMs: Math.max(0, Math.round(currentTime * 1000)),
          type: cleanBody ? "text" : "pin",
          body: cleanBody || (markupAttachment ? "（仅画面标注）" : ""),
          color: composerColor,
          attachments
        })
      });
      const next = await reloadAnnotations();
      const createdAnnotationId = next.at(-1)?.id ?? null;
      setSelectedAnnotationId(createdAnnotationId);
      setSelectedMarkupAnnotationId(markupAttachment ? createdAnnotationId : null);
      setSidebarTab("annotations");
      setMarkupEditorOpen(false);
      setShowUi(true);
      resetMarkupDraft();
      resetComposer();
    } catch (e: any) {
      const detail = e?.data?.issues?.[0]?.message as string | undefined;
      setAnnotationError(detail ?? toZhError(e));
    } finally {
      setComposerSubmitting(false);
      setMarkupSaving(false);
    }
  }

  async function submitDraft(targetAnnotation?: AnnotationRecord) {
    if (!canAnnotate) {
      setAnnotationError("这个分享链接只有查看权限");
      return;
    }
    const cleanBody = draftBody.trim();
    if (!cleanBody && draftAttachments.length === 0) return;
    const activeMediaId = media?.id ?? mediaId;
    if (!activeMediaId || !draftMode) {
      setAnnotationError("未找到对应素材");
      return;
    }
    setDraftSubmitting(true);
    setAnnotationError(null);
    try {
      if (draftMode === "edit") {
        const editingTarget = targetAnnotation ?? flatAnnotations.find((item) => item.id === draftTargetId);
        if (!editingTarget || !draftTargetId) throw new Error("not_found");
        await playerApi(`/annotations/${draftTargetId}`, {
          method: "PATCH",
          body: JSON.stringify({
            timestampMs: editingTarget.timestampMs,
            body: cleanBody,
            color: draftColor,
            attachments: toAttachmentPayload(draftAttachments)
          })
        });
      } else {
        await playerApi(`/media/${activeMediaId}/annotations`, {
          method: "POST",
          body: JSON.stringify({
            timestampMs: Math.max(0, Math.round(currentTime * 1000)),
            type: cleanBody ? "text" : "pin",
            body: cleanBody,
            color: draftColor,
            parentId: draftTargetId,
            attachments: toAttachmentPayload(draftAttachments)
          })
        });
      }
      const next = await reloadAnnotations();
      if (draftMode === "reply" && draftTargetId) {
        setSelectedAnnotationId(draftTargetId);
      } else {
        const targetId = targetAnnotation?.parentId ?? targetAnnotation?.id ?? draftTargetId;
        setSelectedAnnotationId(targetId ?? next.at(-1)?.id ?? null);
      }
      setSidebarTab("annotations");
      closeDraft();
    } catch (e: any) {
      const detail = e?.data?.issues?.[0]?.message as string | undefined;
      setAnnotationError(detail ?? toZhError(e));
    } finally {
      setDraftSubmitting(false);
    }
  }

  async function removeAnnotation(annotationId: string) {
    if (!canAnnotate) return;
    setAnnotationError(null);
    try {
      await playerApi(`/annotations/${annotationId}`, { method: "DELETE" });
      const next = await reloadAnnotations();
      if (selectedAnnotationId === annotationId) {
        setSelectedAnnotationId(next[0]?.id ?? null);
      }
      if (draftMode === "edit" && draftTargetId === annotationId) {
        closeDraft();
      }
      setDeleteTarget(null);
    } catch (e) {
      setAnnotationError(toZhError(e));
    }
  }

  async function toggleAnnotationCompletion(annotation: AnnotationRecord) {
    setAnnotationError(null);
    try {
      await playerApi(`/annotations/${annotation.id}/completion`, {
        method: "PATCH",
        body: JSON.stringify({ completed: !annotation.completedAt })
      });
      const next = await reloadAnnotations();
      const target = next.find((item) => item.id === annotation.id) ?? next[0] ?? null;
      setSelectedAnnotationId(target?.id ?? null);
    } catch (e) {
      setAnnotationError(toZhError(e));
    }
  }

  function openReplyDraft(annotation: AnnotationRecord) {
    if (!canAnnotate) return;
    releasePendingImages(draftAttachments);
    setDraftMode("reply");
    setDraftTargetId(annotation.id);
    setDraftBody(getReplyPrefix(annotation));
    setDraftColor(annotation.color || COLOR_PRESETS[0]!);
    setDraftAttachments([]);
    setSidebarTab("annotations");
    setSelectedAnnotationId(annotation.id);
    seekTo(annotation.timestampMs / 1000, true);
  }

  function handleVideoSurfaceClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, textarea, label, a, [role='button']")) return;
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      void togglePlayback();
    }, 220);
  }

  function handleVideoSurfaceDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, textarea, label, a, [role='button']")) return;
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    void toggleFullscreen();
  }

  function openAttachmentModal(url: string) {
    setAttachmentModal({ url, zoom: 1, offsetX: 0, offsetY: 0, dragging: false, dragOriginX: 0, dragOriginY: 0 });
  }

  function closeAttachmentModal() {
    setAttachmentModal(null);
  }

  function handleAttachmentPointerDown(event: ReactPointerEvent<HTMLImageElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setAttachmentModal((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        dragging: true,
        dragOriginX: event.clientX - prev.offsetX,
        dragOriginY: event.clientY - prev.offsetY
      };
    });
  }

  function handleAttachmentPointerMove(event: ReactPointerEvent<HTMLImageElement>) {
    setAttachmentModal((prev) => {
      if (!prev || !prev.dragging) return prev;
      return {
        ...prev,
        offsetX: event.clientX - prev.dragOriginX,
        offsetY: event.clientY - prev.dragOriginY
      };
    });
  }

  function stopAttachmentDrag(pointerId?: number) {
    setAttachmentModal((prev) => {
      if (!prev) return prev;
      if (!prev.dragging) return prev;
      return { ...prev, dragging: false, dragOriginX: 0, dragOriginY: 0 };
    });
    if (pointerId == null) return;
    const img = document.querySelector<HTMLImageElement>(".mr-player-page__image-modal-image");
    if (img?.hasPointerCapture(pointerId)) img.releasePointerCapture(pointerId);
  }

  function handleAttachmentWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    setAttachmentModal((prev) => {
      if (!prev) return prev;
      const nextZoom = clamp(prev.zoom + (event.deltaY < 0 ? 0.12 : -0.12), 0.4, 4);
      if (nextZoom <= 1) return { ...prev, zoom: Number(nextZoom.toFixed(2)), offsetX: 0, offsetY: 0 };
      return { ...prev, zoom: Number(nextZoom.toFixed(2)) };
    });
  }

  function goBack() {
    if (isShareMode && !isLoggedIn) {
      router.push("/app");
      return;
    }
    router.push(getWorkbenchBackHref());
  }

  async function loadAnnotationsForExport() {
    const activeMediaId = media?.id ?? mediaId;
    if (!activeMediaId && !isShareMode) return [];
    const data = await playerApi<AnnotationListResponse>(`/media/${activeMediaId}/annotations`);
    return hydrateAttachmentPreviewUrls(data.annotations);
  }

  async function copyAnnotationsToClipboard() {
    try {
      const list = await loadAnnotationsForExport();
      await navigator.clipboard.writeText(buildAnnotationTextExport(media?.title ?? "MarkReel", list));
      setAnnotationError(null);
      setShowExportMenu(false);
    } catch (e) {
      setAnnotationError(toZhError(e));
    }
  }

  async function exportAnnotationsTxt() {
    try {
      const list = await loadAnnotationsForExport();
      downloadTextFile(safeExportFileName(media?.title ?? "markreel-annotations", "txt"), buildAnnotationTextExport(media?.title ?? "MarkReel", list), "text/plain;charset=utf-8");
      setAnnotationError(null);
      setShowExportMenu(false);
    } catch (e) {
      setAnnotationError(toZhError(e));
    }
  }

  async function exportAnnotationsCsv() {
    try {
      const list = await loadAnnotationsForExport();
      downloadTextFile(safeExportFileName(media?.title ?? "markreel-annotations", "csv"), buildAnnotationCsvExport(list), "text/csv;charset=utf-8");
      setAnnotationError(null);
      setShowExportMenu(false);
    } catch (e) {
      setAnnotationError(toZhError(e));
    }
  }

  async function exportChapterText() {
    try {
      const list = await loadAnnotationsForExport();
      downloadTextFile(safeExportFileName(`${media?.title ?? "markreel"}-chapters`, "txt"), buildChapterTextExport(list), "text/plain;charset=utf-8");
      setAnnotationError(null);
      setShowExportMenu(false);
    } catch (e) {
      setAnnotationError(toZhError(e));
    }
  }

  function handleTimelinePointer(event: React.MouseEvent<HTMLInputElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    setHoverRatio(ratio);
    setHoverTime((duration || 0) * ratio);
  }

  function beginFastSeek() {
    const video = videoRef.current;
    if (!video) return;
    if (fastSeekTimerRef.current) window.clearInterval(fastSeekTimerRef.current);
    fastSeekPreviousRateRef.current = video.playbackRate;
    video.playbackRate = Math.max(video.playbackRate, 2);
    fastSeekTimerRef.current = window.setInterval(() => seekBy(1.2), 120);
  }

  function endFastSeek() {
    if (fastSeekTimerRef.current) {
      window.clearInterval(fastSeekTimerRef.current);
      fastSeekTimerRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      const previousRate = fastSeekPreviousRateRef.current ?? playbackRate;
      video.playbackRate = previousRate;
      setPlaybackRate(previousRate);
    }
    fastSeekPreviousRateRef.current = null;
  }

  if (loading) {
    return <main className="mr-player-page"><div className="mr-panel mr-player-page__state">加载播放器中…</div></main>;
  }

  if (!media || !previewUrl) {
    return (
      <main className="mr-player-page">
        <div className="mr-panel mr-player-page__state">
          <div>{error ?? "无法打开播放器"}</div>
          <button className="mr-btn mr-btn--primary" type="button" onClick={goBack}>{isShareMode && !isLoggedIn ? "登录" : "返回工作台"}</button>
        </div>
      </main>
    );
  }

  return (
    <main className="mr-player-page">
      <div className="mr-player-page__layout">
        <section className="mr-player-page__main">
          <div className="mr-player-page__topbar">
            <button className="mr-btn mr-btn--primary" type="button" onClick={goBack}>{isShareMode && !isLoggedIn ? "登录" : "返回工作台"}</button>
            <div className="mr-player-page__title-wrap">
              <div className="mr-player-page__eyebrow">审片播放器</div>
              <h1 className="mr-player-page__title">{media.title}</h1>
            </div>
            <div className="mr-player-page__topbar-actions">
              <div className="mr-player-page__export-wrap">
                <button className="mr-btn mr-btn--tool" type="button" onClick={() => setShowExportMenu((prev) => !prev)} aria-haspopup="menu" aria-expanded={showExportMenu}>
                  <IconDownload size={17} stroke={ICON_STROKE} aria-hidden="true" />
                  <span>导出</span>
                </button>
                {showExportMenu ? (
                  <div className="mr-player-page__export-menu" role="menu">
                    <button type="button" className="mr-player-page__export-item" role="menuitem" onClick={() => void copyAnnotationsToClipboard()}>
                      <IconCopy size={16} stroke={ICON_STROKE} aria-hidden="true" />
                      <span>复制标注</span>
                    </button>
                    <button type="button" className="mr-player-page__export-item" role="menuitem" onClick={() => void exportAnnotationsCsv()}>
                      <IconTableExport size={16} stroke={ICON_STROKE} aria-hidden="true" />
                      <span>CSV</span>
                    </button>
                    <button type="button" className="mr-player-page__export-item" role="menuitem" onClick={() => void exportAnnotationsTxt()}>
                      <IconFileText size={16} stroke={ICON_STROKE} aria-hidden="true" />
                      <span>TXT</span>
                    </button>
                    <button type="button" className="mr-player-page__export-item" role="menuitem" onClick={() => void exportChapterText()}>
                      <IconHash size={16} stroke={ICON_STROKE} aria-hidden="true" />
                      <span>章节文本</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mr-player-page__media-stack">
            <div
              className={`mr-player-page__video-shell${isFullscreen ? " mr-player-page__video-shell--fullscreen" : ""}${showUi ? " mr-player-page__video-shell--ui" : " mr-player-page__video-shell--ui-hidden"}${markupEditorOpen ? " mr-player-page__video-shell--markup" : ""}`}
              ref={videoShellRef}
              onMouseLeave={() => !pinUi && isFullscreen && hideUiNow()}
            >
            <div
              className={`mr-player-page__video-surface${showUi ? "" : " mr-player-page__video-surface--ui-hidden"}`}
              onMouseMove={revealUi}
              onMouseLeave={hideUiNow}
              onClick={handleVideoSurfaceClick}
              onDoubleClick={handleVideoSurfaceDoubleClick}
            >
              <video ref={videoRef} key={previewUrl} src={previewUrl} playsInline className="mr-player-page__video" />
              {selectedMarkupAttachment?.previewUrl ? (
                <img className="mr-player-page__saved-markup" src={selectedMarkupAttachment.previewUrl} alt="已保存画笔标注" />
              ) : null}
              {markupEditorOpen ? (
                <div
                  className={`mr-player-page__markup-layer mr-player-page__markup-layer--active${markupTool === "text" ? " mr-player-page__markup-layer--text" : ""}`}
                  onPointerDown={markupTool === "text" ? handleMarkupTextClick : handleMarkupPointerDown}
                  onPointerMove={handleMarkupPointerMove}
                  onPointerUp={finishMarkupPointer}
                  onPointerCancel={finishMarkupPointer}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  <canvas ref={markupCanvasRef} className="mr-player-page__markup-canvas" />
                  {markupTextDraft ? (
                    <input
                      autoFocus
                      className="mr-input mr-player-page__markup-text-input"
                      style={{ left: `${markupTextDraft.x * 100}%`, top: `${markupTextDraft.y * 100}%`, color: markupColor }}
                      value={markupTextDraft.value}
                      placeholder="输入文字"
                      onChange={(event) => setMarkupTextDraft((prev) => prev ? { ...prev, value: event.target.value } : prev)}
                      onBlur={commitMarkupText}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitMarkupText();
                        if (event.key === "Escape") setMarkupTextDraft(null);
                      }}
                      onClick={(event) => event.stopPropagation()}
                    />
                  ) : null}
                </div>
              ) : null}
              <canvas ref={exportCanvasRef} hidden />
            </div>
            {!markupEditorOpen ? (
              <div className={`mr-player-page__overlay mr-player-page__overlay--top${showUi ? "" : " mr-player-page__overlay--hidden"}`}>
                <div className="mr-player-page__overlay-chip" onMouseEnter={keepUiVisible} onMouseLeave={resumeUiHide}>{timeDisplayValue}</div>
                <div className="mr-player-page__overlay-chip" onMouseEnter={keepUiVisible} onMouseLeave={resumeUiHide}>{annotations.length} 条标注</div>
              </div>
            ) : null}
            {!markupEditorOpen ? (
              <div className={`mr-player-page__overlay mr-player-page__overlay--bottom${showUi ? "" : " mr-player-page__overlay--hidden"}`}>
              <div className="mr-player-page__timeline-stack" onMouseEnter={keepUiVisible} onMouseLeave={resumeUiHide}>
                <div className="mr-player-page__timeline-meta">
                  <span>{formatClock(currentTime)}</span>
                  <span>{formatClock(duration)}</span>
                </div>
                <div className="mr-player-page__timeline-wrap">
                  {hoverTime != null ? (
                    <div className="mr-player-page__timeline-tooltip" style={{ left: `${hoverRatio * 100}%` }}>{formatClock(hoverTime)}</div>
                  ) : null}
                  <div className="mr-player-page__markers">
                    {annotations.map((annotation) => {
                      const left = duration > 0 ? `${(annotation.timestampMs / 1000 / duration) * 100}%` : "0%";
                      return (
                        <button
                          key={annotation.id}
                          type="button"
                          className={`mr-player-page__marker${selectedAnnotationId === annotation.id ? " mr-player-page__marker--active" : ""}`}
                          style={{ left, background: annotation.color || COLOR_PRESETS[0] }}
                          title={`${formatClock(annotation.timestampMs / 1000)} ${annotation.body || "标注"}`}
                          onClick={() => selectAnnotation(annotation, true)}
                        />
                      );
                    })}
                  </div>
                  <input
                    className="mr-player-page__timeline"
                    type="range"
                    min={0}
                    max={Math.max(duration, 0.001)}
                    step="0.01"
                    value={Math.min(currentTime, duration || currentTime)}
                    style={{ "--timeline-progress": `${timelineProgress}%` } as CSSProperties}
                    onMouseMove={handleTimelinePointer}
                    onMouseLeave={() => setHoverTime(null)}
                    onChange={(event) => seekTo(Number(event.target.value))}
                  />
                </div>
              </div>
              <div className="mr-player-page__controls">
                <div className="mr-player-page__control-group" onMouseEnter={keepUiVisible} onMouseLeave={resumeUiHide}>
                  <IconButton title={isPlaying ? "暂停" : "播放"} onClick={() => void togglePlayback()}>
                    <PlayerIcon icon={isPlaying ? IconPlayerPause : IconPlayerPlay} />
                  </IconButton>
                  <IconButton title="后退 5 秒" onClick={() => seekBy(-5)}>
                    <PlayerIcon icon={IconArrowBackUp} />
                  </IconButton>
                  <IconButton title="前进 5 秒 / 长按快进" onClick={() => seekBy(5)}>
                    <span
                      className="mr-player-page__long-press-proxy"
                      onMouseDown={beginFastSeek}
                      onMouseUp={endFastSeek}
                      onMouseLeave={endFastSeek}
                    >
                      <PlayerIcon icon={IconArrowForwardUp} />
                    </span>
                  </IconButton>
                  <IconButton title="前一帧" onClick={() => stepFrame(-1)}>
                    <PlayerIcon icon={IconPlayerSkipBack} />
                  </IconButton>
                  <IconButton title="后一帧" onClick={() => stepFrame(1)}>
                    <PlayerIcon icon={IconPlayerSkipForward} />
                  </IconButton>
                </div>
                <div className="mr-player-page__control-group mr-player-page__control-group--right" onMouseEnter={keepUiVisible} onMouseLeave={resumeUiHide}>
                  <div className="mr-player-page__volume-wrap">
                    <IconButton title={muted ? "取消静音" : "静音"} onClick={toggleMute}>
                      <PlayerIcon icon={volumeIcon(volume, muted)} />
                    </IconButton>
                    <input className="mr-player-page__volume" type="range" min={0} max={1} step="0.01" value={muted ? 0 : volume} onChange={(event) => setVideoVolume(Number(event.target.value))} />
                  </div>
                  <div className="mr-player-page__speed-wrap">
                    <IconButton title={`速度 ${formatSpeed(playbackRate)}`} onClick={() => setShowSpeedMenu((prev) => !prev)} active={showSpeedMenu}>
                      <span className="mr-player-page__icon-rate">{formatSpeed(playbackRate)}</span>
                    </IconButton>
                    {showSpeedMenu ? (
                      <div className="mr-player-page__speed-menu">
                        <div className="mr-player-page__speed-preset-list">
                          {SPEED_PRESETS.map((speed) => (
                            <button key={speed} type="button" className={`mr-player-page__speed-item${speed === playbackRate ? " mr-player-page__speed-item--active" : ""}`} onClick={() => setSpeed(speed)}>
                              {formatSpeed(speed)}
                            </button>
                          ))}
                        </div>
                        <div className="mr-player-page__speed-custom">
                          <input className="mr-input mr-player-page__speed-input" value={customSpeed} onChange={(event) => setCustomSpeed(event.target.value)} placeholder="自定义倍速" />
                          <button type="button" className="mr-btn mr-btn--primary" onClick={applyCustomSpeed}>应用</button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="mr-player-page__time-display-wrap">
                    <IconButton title="切换时间显示" onClick={() => setShowTimeDisplayMenu((prev) => !prev)} active={showTimeDisplayMenu}>
                      <PlayerIcon icon={timeDisplayIcon(timeDisplayMode)} />
                    </IconButton>
                    {showTimeDisplayMenu ? (
                      <div className="mr-player-page__time-display-menu">
                        {TIME_DISPLAY_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={`mr-player-page__time-display-item${timeDisplayMode === option.value ? " mr-player-page__time-display-item--active" : ""}`}
                            onClick={() => selectTimeDisplayMode(option.value)}
                          >
                            <span>{option.label}</span>
                            <small>{option.description}</small>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <IconButton title={pinUi ? "关闭 UI 常驻" : "开启 UI 常驻"} onClick={() => setPinUi((prev) => !prev)} active={pinUi}>
                    <PlayerIcon icon={pinUi ? IconPinnedOff : IconPinned} />
                  </IconButton>
                  <IconButton title={isFullscreen ? "退出全屏" : "全屏"} onClick={() => void toggleFullscreen()}>
                    <PlayerIcon icon={isFullscreen ? IconMinimize : IconMaximize} />
                  </IconButton>
                </div>
              </div>
              </div>
            ) : null}
            </div>

          </div>

          {canAnnotate ? <section className={`mr-panel mr-player-page__composer${annotationEditorFullscreen ? " mr-player-page__composer--fullscreen" : ""}${markupEditorOpen ? " mr-player-page__composer--markup" : ""}`}>
            <div className="mr-player-page__section-head">
              <div>
                <div className="mr-player-page__section-kicker">标注输入</div>
                <h2 className="mr-player-page__section-title">在当前时间创建标注</h2>
              </div>
              <div className="mr-player-page__composer-actions">
                <div className="mr-badge">{formatClock(currentTime)}</div>
                <button className="mr-btn mr-btn--tool" type="button" onClick={() => setShowShortcutDialog(true)}>
                  <IconKeyboard size={17} stroke={ICON_STROKE} aria-hidden="true" />
                  <span>快捷键</span>
                </button>
                <button className="mr-btn mr-btn--tool" type="button" onClick={() => setAnnotationEditorFullscreen((prev) => !prev)}>
                  <PlayerIcon icon={annotationEditorFullscreen ? IconMinimize : IconMaximize} />
                  <span>{annotationEditorFullscreen ? "退出全屏编辑" : "全屏编辑"}</span>
                </button>
              </div>
            </div>

            {markupEditorOpen ? (
              <div className="mr-player-page__markup-toolbar" onClick={(event) => event.stopPropagation()}>
                <div className="mr-player-page__markup-tools">
                  {([
                    ["brush", "画笔"],
                    ["text", "文字"],
                    ["rect", "方框"],
                    ["circle", "圆形"]
                  ] as Array<[MarkupTool, string]>).map(([tool, label]) => (
                    <button
                      key={tool}
                      className={`mr-btn mr-btn--surface mr-player-page__markup-tool${markupTool === tool ? " mr-player-page__tab--active" : ""}`}
                      type="button"
                      onClick={() => setMarkupTool(tool)}
                      title={label}
                    >
                      <PlayerIcon icon={markupToolIcon(tool)} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                <div className="mr-player-page__swatches">
                  {COLOR_PRESETS.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      className={`mr-player-page__swatch${markupColor === swatch ? " mr-player-page__swatch--active" : ""}`}
                      style={{ background: swatch }}
                      onClick={() => setMarkupColor(swatch)}
                      aria-label={`画笔颜色 ${swatch}`}
                    />
                  ))}
                </div>
                <label className="mr-player-page__markup-width">
                  <span>粗细 {markupWidth}</span>
                  <input type="range" min="2" max="18" value={markupWidth} onChange={(event) => setMarkupWidth(Number(event.target.value))} />
                </label>
                <label className="mr-player-page__markup-width">
                  <span>透明 {Math.round(markupOpacity * 100)}%</span>
                  <input type="range" min="0.15" max="1" step="0.05" value={markupOpacity} onChange={(event) => setMarkupOpacity(Number(event.target.value))} />
                </label>
                <button className="mr-btn" type="button" onClick={() => setMarkupOperations((prev) => prev.slice(0, -1))} disabled={markupOperations.length === 0 || markupSaving}>撤销</button>
                <button className="mr-btn" type="button" onClick={resetMarkupDraft} disabled={markupOperations.length === 0 || markupSaving}>清空</button>
                <button className="mr-btn" type="button" onClick={cancelMarkupEditor} disabled={markupSaving}>取消</button>
              </div>
            ) : null}

            <div className="mr-player-page__editor-shell" onPaste={(event) => void handleEditorPaste(event, "composer")}>
              <textarea
                className={`mr-input mr-player-page__textarea${composerAttachments.length > 0 ? " mr-player-page__textarea--with-attachments" : ""}`}
                placeholder={annotationEditorFullscreen ? "输入标注内容；可直接 Ctrl+V 粘贴图片" : "输入标注内容或摘要"}
                value={composerBody}
                onChange={(event) => setComposerBody(event.target.value)}
              />
              {composerAttachments.length > 0 ? (
                <div className="mr-player-page__attachment-grid">
                  {composerAttachments.map((attachment, index) => (
                    <figure key={`${attachment.objectKey || attachment.localUrl || index}-${index}`} className="mr-player-page__attachment-card">
                      {attachment.previewUrl ? (
                        <button type="button" className="mr-player-page__annotation-image-link" onClick={() => openAttachmentModal(attachment.previewUrl!)}>
                          <img className="mr-player-page__attachment-image" src={attachment.previewUrl} alt="annotation attachment" />
                          <figcaption className="mr-player-page__attachment-caption">{attachment.width && attachment.height ? `${attachment.width}×${attachment.height}` : "image"}</figcaption>
                        </button>
                      ) : (
                        <div className="mr-player-page__attachment-fallback">图片</div>
                      )}
                      <button
                        className="mr-player-page__attachment-remove mr-player-page__attachment-remove--floating"
                        type="button"
                        onClick={() => removeComposerAttachment(index)}
                      >
                        ×
                      </button>
                    </figure>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mr-player-page__composer-footer">
              <div className="mr-player-page__composer-row">
                <div className="mr-player-page__swatches">
                  {COLOR_PRESETS.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      className={`mr-player-page__swatch${composerColor === swatch ? " mr-player-page__swatch--active" : ""}`}
                      style={{ background: swatch }}
                      onClick={() => setComposerColor(swatch)}
                      aria-label={`颜色 ${swatch}`}
                    />
                  ))}
                </div>
                <button className="mr-btn mr-btn--tool" type="button" onClick={toggleMarkupEditor}>
                  <PlayerIcon icon={IconBrush} />
                  <span>{markupEditorOpen ? "退出画笔" : "画面标注"}</span>
                </button>
                <button className="mr-btn mr-btn--tool" type="button" onClick={() => triggerAttachmentPicker("composer")}>
                  <IconPhotoPlus size={17} stroke={ICON_STROKE} aria-hidden="true" />
                  <span>{composerUploading ? "上传图片中…" : "插入图片"}</span>
                </button>
                <input ref={attachmentInputRef} id="mr-player-page-attachment-input" type="file" accept="image/*" multiple hidden onChange={handleAttachmentInput} />
                <button
                  className="mr-btn mr-btn--primary"
                  type="button"
                  onClick={() => void createAnnotation()}
                  disabled={composerSubmitting || composerUploading || markupSaving || (!composerBody.trim() && composerAttachments.length === 0 && markupOperations.length === 0)}
                >
                  {composerSubmitting || markupSaving ? "创建中…" : "创建标注"}
                </button>
              </div>

              {annotationError ? <div className="mr-feedback mr-feedback--error">{annotationError}</div> : null}
            </div>
          </section> : (
            <section className="mr-panel mr-player-page__composer">
              <div className="mr-dialog__note">这个链接只有查看权限，可以查看视频和已有标注，不能新增或编辑标注。</div>
              {annotationError ? <div className="mr-feedback mr-feedback--error">{annotationError}</div> : null}
            </section>
          )}
        </section>

        <aside className="mr-player-page__sidebar">
          <div className="mr-player-page__tabs">
            <button className={`mr-btn mr-btn--surface mr-player-page__tab${sidebarTab === "file" ? " mr-player-page__tab--active" : ""}`} type="button" onClick={() => setSidebarTab("file")}>文件信息</button>
            <button className={`mr-btn mr-btn--surface mr-player-page__tab${sidebarTab === "annotations" ? " mr-player-page__tab--active" : ""}`} type="button" onClick={() => setSidebarTab("annotations")}>标注信息</button>
          </div>

          {sidebarTab === "file" ? (
            <div className="mr-panel mr-player-page__sidebar-card">
              <div className="mr-player-page__meta-grid">
                <div className="mr-project-meta mr-player-page__meta-row"><span>标题</span><strong className="mr-player-page__meta-value mr-player-page__meta-value--wrap">{media.title}</strong></div>
                <div className="mr-project-meta mr-player-page__meta-row"><span>创建者</span><strong className="mr-player-page__meta-value mr-player-page__meta-value--wrap">{media.creator?.displayName || media.creator?.username || "未知"}</strong></div>
                <div className="mr-project-meta mr-player-page__meta-row"><span>创建时间</span><strong>{formatDateTime(media.createdAt)}</strong></div>
                <div className="mr-project-meta mr-player-page__meta-row"><span>时长</span><strong>{formatDuration(duration)}</strong></div>
                <div className="mr-project-meta mr-player-page__meta-row"><span>分辨率</span><strong>{primaryFile?.width && primaryFile?.height ? `${primaryFile.width}×${primaryFile.height}` : "未知"}</strong></div>
                <div className="mr-project-meta mr-player-page__meta-row"><span>FPS</span><strong>{fpsDisplay}</strong></div>
                <div className="mr-project-meta mr-player-page__meta-row"><span>码率</span><strong>{primaryFile?.bitrateKbps ? `${primaryFile.bitrateKbps} kbps` : "未知"}</strong></div>
                <div className="mr-project-meta mr-player-page__meta-row"><span>大小</span><strong>{formatBytes(primaryFile?.sizeBytes ?? undefined)}</strong></div>
                <div className="mr-project-meta mr-player-page__meta-row"><span>状态</span><strong>{media.status}</strong></div>
                {!isShareMode ? <div className="mr-project-meta mr-player-page__meta-row mr-player-page__rating-row">
                  <span>评分</span>
                  <div className="mr-player-page__rating-block">
                    <span className="mr-player-page__rating" role="radiogroup" aria-label="视频评分">
                      {Array.from({ length: 5 }, (_, index) => {
                        const value = index + 1;
                        return (
                          <button
                            key={value}
                            type="button"
                            className={`mr-player-page__rating-star${draftRating >= value ? " mr-player-page__rating-star--active" : ""}`}
                            onClick={() => setDraftRating(value)}
                            disabled={savingRating}
                            aria-label={`${value} 星`}
                          >
                            ★
                          </button>
                        );
                      })}
                    </span>
                    <span className="mr-player-page__rating-inline">
                      <button className="mr-btn mr-btn--primary" type="button" onClick={() => void saveRating()} disabled={savingRating || draftRating < 1 || draftRating > 5 || draftRating === (media.myRating ?? 0)}>
                        {savingRating ? "提交中…" : "提交评分"}
                      </button>
                      <span className="mr-badge">我的评分：{media.myRating ?? "未评分"}</span>
                      <span className="mr-badge">平均分：{media.averageRating ?? "--"}/5</span>
                      <span className="mr-badge">{media.ratingCount} 人评分</span>
                    </span>
                  </div>
                </div> : null}
              </div>
            </div>
          ) : (
            <div className="mr-panel mr-player-page__sidebar-card mr-player-page__sidebar-card--scroll">
              <div className="mr-player-page__section-head mr-player-page__annotation-panel-head">
                <div>
                  <div className="mr-player-page__section-kicker">标注队列</div>
                  <h2 className="mr-player-page__section-title">时间顺序</h2>
                </div>
                <div className="mr-player-page__annotation-toolbar">
                  <div className="mr-player-page__filter-group">
                    <button className={`mr-btn mr-btn--surface${statusFilter === "all" ? " mr-player-page__tab--active" : ""}`} type="button" onClick={() => setStatusFilter("all")}>全部</button>
                    <button className={`mr-btn mr-btn--surface${statusFilter === "completed" ? " mr-player-page__tab--active" : ""}`} type="button" onClick={() => setStatusFilter("completed")}>已完成</button>
                    <button className={`mr-btn mr-btn--surface${statusFilter === "incomplete" ? " mr-player-page__tab--active" : ""}`} type="button" onClick={() => setStatusFilter("incomplete")}>未完成</button>
                  </div>
                  <div className="mr-badge">{filteredCount} / {filteredCount + totalReplyCount}</div>
                </div>
              </div>

              <div className="mr-player-page__annotation-scroll-body">
                {annotationLoading ? (
                  <div className="mr-player-page__empty">正在加载标注…</div>
                ) : annotations.length === 0 ? (
                  <div className="mr-player-page__empty">还没有标注，先创建第一条。</div>
                ) : (
                  <div className="mr-player-page__annotation-list">
                  {annotations.map((annotation, annotationIndex) => {
                    const displayName = annotation.author?.displayName ?? annotation.author?.username ?? "未知用户";
                    const isEditing = draftMode === "edit" && draftTargetId === annotation.id;
                    const showReplyDraft = draftMode === "reply" && draftTargetId === annotation.id;
                    const annotationNumber = annotationIndex + 1;
                    return (
                      <article key={annotation.id} className={`mr-player-page__annotation-item${selectedAnnotationId === annotation.id ? " mr-player-page__annotation-item--active" : ""}`}>
                        <div className="mr-player-page__annotation-main">
                          <div className="mr-player-page__annotation-card-head">
                            <button type="button" className="mr-player-page__annotation-anchor" onClick={() => selectAnnotation(annotation)}>
                              <span className="mr-player-page__annotation-timecode" style={{ "--annotation-color": annotation.color || COLOR_PRESETS[0] } as CSSProperties}>
                                <span className="mr-player-page__annotation-order" aria-hidden="true">{annotationNumber}</span>
                                <strong>{formatClock(annotation.timestampMs / 1000)}</strong>
                              </span>
                              <UserAvatar src={annotation.author?.avatarUrl} preset={annotation.author?.avatarPreset} name={annotation.author?.username ?? displayName} className="mr-player-page__annotation-avatar" alt={`${displayName} 的头像`} />
                              <span className="mr-player-page__annotation-author-block">
                                <span className="mr-player-page__annotation-author-row">
                                  <strong>{displayName}</strong>
                                </span>
                                <span className="mr-player-page__annotation-meta">{formatDateTime(annotation.createdAt)}</span>
                              </span>
                            </button>
                            <button
                              type="button"
                              className={`mr-player-page__annotation-complete${annotation.completedAt ? " mr-player-page__annotation-complete--done" : ""}`}
                              title={annotation.completedAt ? "撤销完成" : "标记完成"}
                              aria-label={annotation.completedAt ? "撤销完成" : "标记完成"}
                              onClick={() => void toggleAnnotationCompletion(annotation)}
                              disabled={!canAnnotate}
                            >
                              {annotation.completedAt ? <PlayerIcon icon={IconCheck} /> : <span aria-hidden="true" />}
                            </button>
                          </div>

                          {isEditing ? (
                            <div className="mr-player-page__annotation-editing">
                              <textarea
                                className="mr-input mr-player-page__annotation-edit-textarea mr-player-page__textarea"
                                value={draftBody}
                                onChange={(event) => setDraftBody(event.target.value)}
                                onPaste={(event) => void handleEditorPaste(event, "draft")}
                              />
                              {draftAttachments.length > 0 ? (
                                <div className="mr-player-page__attachment-grid">
                                  {draftAttachments.map((attachment, index) => (
                                    <figure key={`${attachment.objectKey || attachment.localUrl || index}-${index}`} className="mr-player-page__attachment-card">
                                      {attachment.previewUrl ? (
                                        <button type="button" className="mr-player-page__annotation-image-link" onClick={() => openAttachmentModal(attachment.previewUrl!)}>
                                          <img className="mr-player-page__attachment-image" src={attachment.previewUrl} alt="annotation attachment" />
                                          <figcaption className="mr-player-page__attachment-caption">{attachment.width && attachment.height ? `${attachment.width}×${attachment.height}` : "image"}</figcaption>
                                        </button>
                                      ) : (
                                        <div className="mr-player-page__attachment-fallback">图片</div>
                                      )}
                                      <button
                                        className="mr-player-page__attachment-remove mr-player-page__attachment-remove--floating"
                                        type="button"
                                        onClick={() => {
                                          setDraftAttachments((prev) => {
                                            const target = prev[index];
                                            if (target?.localUrl) URL.revokeObjectURL(target.localUrl);
                                            return prev.filter((_, itemIndex) => itemIndex !== index);
                                          });
                                        }}
                                      >
                                        ×
                                      </button>
                                    </figure>
                                  ))}
                                </div>
                              ) : null}
                              <div className="mr-player-page__annotation-edit-tools">
                                <div className="mr-player-page__swatches">
                                  {COLOR_PRESETS.map((swatch) => (
                                    <button
                                      key={swatch}
                                      type="button"
                                      className={`mr-player-page__swatch${draftColor === swatch ? " mr-player-page__swatch--active" : ""}`}
                                      style={{ background: swatch }}
                                      onClick={() => setDraftColor(swatch)}
                                      aria-label={`颜色 ${swatch}`}
                                    />
                                  ))}
                                </div>
                                <div className="mr-player-page__annotation-edit-tools-right">
                                  <button className="mr-btn" type="button" onClick={() => triggerAttachmentPicker("draft")}>{draftUploading ? "上传图片中…" : "插入图片"}</button>
                                  <button className="mr-btn" type="button" onClick={cancelDraft} disabled={draftSubmitting || draftUploading}>取消</button>
                                  <button className="mr-btn mr-btn--primary" type="button" onClick={() => void submitDraft(annotation)} disabled={draftSubmitting || draftUploading || (!draftBody.trim() && draftAttachments.length === 0)}>
                                    {draftSubmitting ? "保存中…" : "保存编辑"}
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="mr-player-page__annotation-body">{annotation.body || "（仅画面标注）"}</div>
                              {annotation.attachments.length > 0 ? (
                                <div className="mr-player-page__annotation-attachments mr-player-page__annotation-attachments--images">
                                  {annotation.attachments.map((attachment, index) => (
                                    <button
                                      key={`${attachment.objectKey}-${index}`}
                                      type="button"
                                      className="mr-player-page__annotation-image-link"
                                      onClick={() => attachment.previewUrl ? openAttachmentModal(attachment.previewUrl) : undefined}
                                    >
                                      {attachment.previewUrl ? <img className="mr-player-page__annotation-image" src={attachment.previewUrl} alt="annotation attachment" /> : null}
                                      <span className="mr-badge">{attachment.width && attachment.height ? `${attachment.width}×${attachment.height}` : "image"}</span>
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                              {annotation.replies?.length || showReplyDraft ? (
                                <div className="mr-player-page__annotation-replies">
                                  {annotation.replies?.map((reply, replyIndex) => {
                                    const replyName = reply.author?.displayName ?? reply.author?.username ?? "未知用户";
                                    const isReplyEditing = draftMode === "edit" && draftTargetId === reply.id;
                                    const replyNumber = `${annotationNumber}-${replyIndex + 1}`;
                                    return (
                                      <div key={reply.id} className="mr-player-page__annotation-reply">
                                        <span className="mr-player-page__annotation-order mr-player-page__annotation-order--reply" aria-hidden="true">{replyNumber}</span>
                                        <UserAvatar src={reply.author?.avatarUrl} preset={reply.author?.avatarPreset} name={reply.author?.username ?? replyName} className="mr-player-page__annotation-avatar mr-player-page__annotation-avatar--reply" alt={`${replyName} 的头像`} />
                                        <div className="mr-player-page__annotation-reply-body">
                                          <div className="mr-player-page__annotation-author-row">
                                            <strong>{replyName}</strong>
                                            <span className="mr-badge">{formatClock(reply.timestampMs / 1000)}</span>
                                          </div>
                                          <span className="mr-player-page__annotation-meta">{formatDateTime(reply.createdAt)}</span>
                                          {isReplyEditing ? (
                                            <div className="mr-player-page__annotation-editing">
                                              <textarea
                                                className="mr-input mr-player-page__annotation-edit-textarea mr-player-page__textarea"
                                                value={draftBody}
                                                onChange={(event) => setDraftBody(event.target.value)}
                                                onPaste={(event) => void handleEditorPaste(event, "draft")}
                                              />
                                              {draftAttachments.length > 0 ? (
                                                <div className="mr-player-page__attachment-grid">
                                                  {draftAttachments.map((attachment, index) => (
                                                    <figure key={`${attachment.objectKey || attachment.localUrl || index}-${index}`} className="mr-player-page__attachment-card">
                                                      {attachment.previewUrl ? (
                                                        <button type="button" className="mr-player-page__annotation-image-link" onClick={() => openAttachmentModal(attachment.previewUrl!)}>
                                                          <img className="mr-player-page__attachment-image" src={attachment.previewUrl} alt="annotation attachment" />
                                                          <figcaption className="mr-player-page__attachment-caption">{attachment.width && attachment.height ? `${attachment.width}×${attachment.height}` : "image"}</figcaption>
                                                        </button>
                                                      ) : (
                                                        <div className="mr-player-page__attachment-fallback">图片</div>
                                                      )}
                                                      <button
                                                        className="mr-player-page__attachment-remove mr-player-page__attachment-remove--floating"
                                                        type="button"
                                                        onClick={() => {
                                                          setDraftAttachments((prev) => {
                                                            const target = prev[index];
                                                            if (target?.localUrl) URL.revokeObjectURL(target.localUrl);
                                                            return prev.filter((_, itemIndex) => itemIndex !== index);
                                                          });
                                                        }}
                                                      >
                                                        ×
                                                      </button>
                                                    </figure>
                                                  ))}
                                                </div>
                                              ) : null}
                                              <div className="mr-player-page__annotation-edit-tools">
                                                <div className="mr-player-page__swatches">
                                                  {COLOR_PRESETS.map((swatch) => (
                                                    <button
                                                      key={swatch}
                                                      type="button"
                                                      className={`mr-player-page__swatch${draftColor === swatch ? " mr-player-page__swatch--active" : ""}`}
                                                      style={{ background: swatch }}
                                                      onClick={() => setDraftColor(swatch)}
                                                      aria-label={`颜色 ${swatch}`}
                                                    />
                                                  ))}
                                                </div>
                                                <div className="mr-player-page__annotation-edit-tools-right">
                                                  <button className="mr-btn" type="button" onClick={() => triggerAttachmentPicker("draft")}>{draftUploading ? "上传图片中…" : "插入图片"}</button>
                                                  <button className="mr-btn" type="button" onClick={cancelDraft} disabled={draftSubmitting || draftUploading}>取消</button>
                                                  <button className="mr-btn mr-btn--primary" type="button" onClick={() => void submitDraft(reply)} disabled={draftSubmitting || draftUploading || (!draftBody.trim() && draftAttachments.length === 0)}>
                                                    {draftSubmitting ? "保存中…" : "保存编辑"}
                                                  </button>
                                                </div>
                                              </div>
                                            </div>
                                          ) : (
                                            <>
                                              <div className="mr-player-page__annotation-body mr-player-page__annotation-reply-copy">{reply.body || getReplyPrefix(annotation)}</div>
                                              {reply.attachments.length > 0 ? (
                                                <div className="mr-player-page__annotation-attachments mr-player-page__annotation-attachments--images">
                                                  {reply.attachments.map((attachment, index) => (
                                                    <button
                                                      key={`${attachment.objectKey}-${index}`}
                                                      type="button"
                                                      className="mr-player-page__annotation-image-link"
                                                      onClick={() => attachment.previewUrl ? openAttachmentModal(attachment.previewUrl) : undefined}
                                                    >
                                                      {attachment.previewUrl ? <img className="mr-player-page__annotation-image" src={attachment.previewUrl} alt="reply attachment" /> : null}
                                                      <span className="mr-badge">{attachment.width && attachment.height ? `${attachment.width}×${attachment.height}` : "image"}</span>
                                                    </button>
                                                  ))}
                                                </div>
                                              ) : null}
                                            </>
                                          )}
                                        </div>
                                        {!isReplyEditing ? (
                                          <div className="mr-player-page__annotation-actions mr-player-page__annotation-actions--reply">
                                            <IconButton title="跳转到时间点" onClick={() => selectAnnotation(reply)}>
                                              <PlayerIcon icon={IconExternalLink} />
                                            </IconButton>
                                            {canAnnotate ? <IconButton title="编辑回复" onClick={() => openEditDraft(reply)}>
                                              <PlayerIcon icon={IconEdit} />
                                            </IconButton> : null}
                                            <IconButton title="复制内容" onClick={() => void navigator.clipboard?.writeText(reply.body || "")} disabled={!reply.body}>
                                              <PlayerIcon icon={IconCopy} />
                                            </IconButton>
                                            {canAnnotate ? <IconButton title="删除回复" onClick={() => setDeleteTarget(reply)}>
                                              <PlayerIcon icon={IconTrash} />
                                            </IconButton> : null}
                                          </div>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                  {showReplyDraft ? (
                                    <div className="mr-player-page__annotation-reply mr-player-page__annotation-reply--draft">
                                      <UserAvatar className="mr-player-page__annotation-avatar mr-player-page__annotation-avatar--reply" />
                                      <div className="mr-player-page__annotation-reply-body">
                                        <div className="mr-player-page__annotation-author-row">
                                          <strong>新回复</strong>
                                          <span className="mr-badge">{formatClock(annotation.timestampMs / 1000)}</span>
                                        </div>
                                        <textarea
                                          className="mr-input mr-player-page__annotation-edit-textarea mr-player-page__textarea"
                                          value={draftBody}
                                          onChange={(event) => setDraftBody(event.target.value)}
                                          onPaste={(event) => void handleEditorPaste(event, "draft")}
                                          placeholder={getReplyPrefix(annotation)}
                                        />
                                        {draftAttachments.length > 0 ? (
                                          <div className="mr-player-page__attachment-grid">
                                            {draftAttachments.map((attachment, index) => (
                                              <figure key={`${attachment.objectKey || attachment.localUrl || index}-${index}`} className="mr-player-page__attachment-card">
                                                {attachment.previewUrl ? (
                                                  <button type="button" className="mr-player-page__annotation-image-link" onClick={() => openAttachmentModal(attachment.previewUrl!)}>
                                                    <img className="mr-player-page__attachment-image" src={attachment.previewUrl} alt="reply attachment" />
                                                    <figcaption className="mr-player-page__attachment-caption">{attachment.width && attachment.height ? `${attachment.width}×${attachment.height}` : "image"}</figcaption>
                                                  </button>
                                                ) : (
                                                  <div className="mr-player-page__attachment-fallback">图片</div>
                                                )}
                                                <button
                                                  className="mr-player-page__attachment-remove mr-player-page__attachment-remove--floating"
                                                  type="button"
                                                  onClick={() => {
                                                    setDraftAttachments((prev) => {
                                                      const target = prev[index];
                                                      if (target?.localUrl) URL.revokeObjectURL(target.localUrl);
                                                      return prev.filter((_, itemIndex) => itemIndex !== index);
                                                    });
                                                  }}
                                                >
                                                  ×
                                                </button>
                                              </figure>
                                            ))}
                                          </div>
                                        ) : null}
                                        <div className="mr-player-page__annotation-edit-tools">
                                          <div className="mr-player-page__swatches">
                                            {COLOR_PRESETS.map((swatch) => (
                                              <button
                                                key={swatch}
                                                type="button"
                                                className={`mr-player-page__swatch${draftColor === swatch ? " mr-player-page__swatch--active" : ""}`}
                                                style={{ background: swatch }}
                                                onClick={() => setDraftColor(swatch)}
                                                aria-label={`颜色 ${swatch}`}
                                              />
                                            ))}
                                          </div>
                                          <div className="mr-player-page__annotation-edit-tools-right">
                                            <button className="mr-btn" type="button" onClick={() => triggerAttachmentPicker("draft")}>{draftUploading ? "上传图片中…" : "插入图片"}</button>
                                            <button className="mr-btn" type="button" onClick={cancelDraft} disabled={draftSubmitting || draftUploading}>取消</button>
                                            <button className="mr-btn mr-btn--primary" type="button" onClick={() => void submitDraft(annotation)} disabled={draftSubmitting || draftUploading || (!draftBody.trim() && draftAttachments.length === 0)}>
                                              {draftSubmitting ? "保存中…" : "保存回复"}
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                        {!isEditing ? (
                          <div className="mr-player-page__annotation-actions">
                            <IconButton title="跳转到时间点" onClick={() => selectAnnotation(annotation)}>
                              <PlayerIcon icon={IconExternalLink} />
                            </IconButton>
                            {canAnnotate ? <IconButton title="编辑标注" onClick={() => openEditDraft(annotation)}>
                              <PlayerIcon icon={IconEdit} />
                            </IconButton> : null}
                            {canAnnotate ? <IconButton title="回复标注" onClick={() => openReplyDraft(annotation)}>
                              <PlayerIcon icon={IconMessageReply} />
                            </IconButton> : null}
                            <IconButton title="复制内容" onClick={() => void navigator.clipboard?.writeText(annotation.body || "")} disabled={!annotation.body}>
                              <PlayerIcon icon={IconCopy} />
                            </IconButton>
                            {canAnnotate ? <IconButton title="删除标注" onClick={() => setDeleteTarget(annotation)}>
                              <PlayerIcon icon={IconTrash} />
                            </IconButton> : null}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
      {attachmentModal ? (
        <div className="mr-player-page__image-modal" role="dialog" aria-modal="true" onClick={closeAttachmentModal}>
          <div className="mr-player-page__image-modal-backdrop" />
          <div className="mr-player-page__image-modal-content" onClick={(event) => event.stopPropagation()} onWheel={handleAttachmentWheel}>
            <div className="mr-player-page__image-modal-toolbar">
              <span className="mr-badge">滚轮缩放 {Math.round(attachmentModal.zoom * 100)}%</span>
              <button className="mr-btn mr-btn--primary" type="button" onClick={closeAttachmentModal}>关闭</button>
            </div>
            <div className="mr-player-page__image-modal-stage">
              <img
                className={`mr-player-page__image-modal-image${attachmentModal.dragging ? " mr-player-page__image-modal-image--dragging" : ""}`}
                src={attachmentModal.url}
                alt="annotation preview"
                onPointerDown={handleAttachmentPointerDown}
                onPointerMove={handleAttachmentPointerMove}
                onPointerUp={(event) => stopAttachmentDrag(event.pointerId)}
                onPointerCancel={(event) => stopAttachmentDrag(event.pointerId)}
                style={{ transform: `translate(${attachmentModal.offsetX}px, ${attachmentModal.offsetY}px) scale(${attachmentModal.zoom})` }}
              />
            </div>
          </div>
        </div>
      ) : null}
      <Dialog
        open={showShortcutDialog}
        title="播放器快捷键"
        description="这些快捷键只在焦点不在输入框内时生效。"
        onClose={() => setShowShortcutDialog(false)}
        footer={
          <button type="button" className="mr-btn mr-btn--primary" onClick={() => setShowShortcutDialog(false)}>
            知道了
          </button>
        }
      >
        <div className="mr-dialog__stack">
          <div className="mr-player-page__dialog-option-list">
            <div className="mr-player-page__dialog-option">
              <div>
                <strong>空格</strong>
                <p>播放 / 暂停视频。</p>
              </div>
            </div>
            <div className="mr-player-page__dialog-option">
              <div>
                <strong>← / →</strong>
                <p>后退或前进 5 秒。</p>
              </div>
            </div>
            <div className="mr-player-page__dialog-option">
              <div>
                <strong>F</strong>
                <p>进入或退出全屏。</p>
              </div>
            </div>
            <div className="mr-player-page__dialog-option">
              <div>
                <strong>M</strong>
                <p>静音或恢复声音。</p>
              </div>
            </div>
          </div>
          <div className="mr-dialog__note">输入标注正文时，快捷键会自动让位给文本输入，不会抢焦点。</div>
        </div>
      </Dialog>
      <Dialog
        open={Boolean(deleteTarget)}
        title="删除标注"
        description="删除后该标注及其楼中回复将不可恢复。"
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <button type="button" className="mr-btn mr-btn--ghost" onClick={() => setDeleteTarget(null)}>
              取消
            </button>
            <button type="button" className="mr-btn mr-btn--primary" onClick={() => deleteTarget ? void removeAnnotation(deleteTarget.id) : undefined}>
              确认删除
            </button>
          </>
        }
      >
        <div className="mr-player-page__delete-copy">{deleteTarget?.body || "将删除这条标注。"}</div>
      </Dialog>
    </main>
  );
}

export default function PlayerPage() {
  return (
    <Suspense fallback={<main className="mr-player-page"><div className="mr-panel mr-player-page__state">加载播放器中…</div></main>}>
      <PlayerPageInner />
    </Suspense>
  );
}
