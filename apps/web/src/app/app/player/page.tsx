"use client";

import type { ChangeEvent, ClipboardEvent, PointerEvent as ReactPointerEvent, ReactNode, WheelEvent } from "react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Dialog } from "../_components/dialog";

type MediaDetail = {
  id: string;
  projectId: string;
  folderId: string | null;
  title: string;
  status: string;
  reviewStatus: string;
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
  completedBy?: { id: string; username: string; displayName: string | null } | null;
  createdAt: string;
  updatedAt: string;
  author?: { id: string; username: string; displayName: string | null };
  attachments: AnnotationAttachment[];
  replies?: AnnotationRecord[];
};

type MediaResponse = { media: MediaDetail };
type AnnotationListResponse = { annotations: AnnotationRecord[] };
type AttachmentPresignResponse = {
  upload: {
    method: "PUT";
    url: string;
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

type SidebarTab = "file" | "annotations";
type AnnotationStatusFilter = "all" | "completed" | "incomplete";
type TimeDisplayMode = "elapsed_total" | "remaining_total" | "frame";
type PendingImage = AnnotationAttachment & { localUrl?: string };
type DraftMode = "edit" | "reply";
type UploadTarget = "composer" | "draft";

const COLOR_PRESETS = ["#c96442", "#d7a55a", "#5f8f64", "#5f85d6", "#9a68d8", "#d55f8d"];
const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const TIME_DISPLAY_OPTIONS: Array<{ value: TimeDisplayMode; label: string; description: string }> = [
  { value: "elapsed_total", label: "当前 / 总时长", description: "显示当前播放时间与总时长，例如 01:23/10:00。" },
  { value: "remaining_total", label: "剩余 / 总时长", description: "显示剩余时长与总时长，例如 -08:37/10:00。" },
  { value: "frame", label: "当前帧 / 总帧", description: "按当前帧数显示，适合逐帧审阅。" }
];
const UI_HIDE_DELAY_MS = 2000;

function PlayerIcon({ children }: { children: ReactNode }) {
  return <span className="mr-player-page__icon-glyph" aria-hidden="true">{children}</span>;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(`/api${path}`, { ...init, headers, credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error("api_error"), { status: res.status, data });
  return data as T;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const mediaId = searchParams.get("mid") ?? "";
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoShellRef = useRef<HTMLDivElement | null>(null);
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
  const [showShortcutDialog, setShowShortcutDialog] = useState(false);
  const [showTimeDisplayDialog, setShowTimeDisplayDialog] = useState(false);
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
  const clickTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!mediaId) {
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
    Promise.all([api<MediaResponse>(`/media/${mediaId}`), api<PreviewResponse>(`/media/${mediaId}/preview`)])
      .then(([mediaData, previewData]) => {
        if (cancelled) return;
        setMedia(mediaData.media);
        setPreviewUrl(previewData.preview.url);
        setDraftRating(mediaData.media.myRating ?? 0);
        const file = mediaData.media.files[0];
        setDuration(file?.durationMs ? file.durationMs / 1000 : 0);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(toZhError(e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mediaId]);

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
        const data = await api<AttachmentPreviewResponse>(`/annotations/${annotationId}/attachments/${attachmentId}/preview`);
        return [attachmentId, data.preview.url] as const;
      })
    );
    return mergePreviewUrls(list, Object.fromEntries(previews));
  }

  async function reloadAnnotations(filter = statusFilter) {
    const query = filter === "all" ? "" : `?status=${filter}`;
    const data = await api<AnnotationListResponse>(`/media/${mediaId}/annotations${query}`);
    const hydrated = await hydrateAttachmentPreviewUrls(data.annotations);
    setAnnotations(hydrated);
    return hydrated;
  }

  useEffect(() => {
    if (!mediaId) {
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
  }, [mediaId, statusFilter]);

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
  const primaryFile = media?.files.find((file) => file.mode === "derived") ?? media?.files[0] ?? null;
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
    if (!isFullscreen) return;
    setShowUi(true);
    scheduleUiHide();
  }

  function keepUiVisible() {
    if (!isFullscreen) return;
    clearUiHideTimer();
    setShowUi(true);
  }

  function resumeUiHide() {
    if (!isFullscreen || pinUi) return;
    scheduleUiHide();
  }

  function hideUiNow() {
    if (!isFullscreen || pinUi) return;
    clearUiHideTimer();
    setShowUi(false);
  }

  function seekTo(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
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
    if (video.paused) await video.play();
    else video.pause();
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

  function openTimeDisplayDialog() {
    setShowTimeDisplayDialog(true);
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
          const data = await api<AttachmentPresignResponse>("/attachments/presign", {
            method: "POST",
            body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream" })
          });
          await uploadToPresignedUrl(data.upload.url, file);
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
    releasePendingImages(draftAttachments);
    setDraftMode("edit");
    setDraftTargetId(annotation.id);
    setDraftBody(annotation.body);
    setDraftColor(annotation.color || COLOR_PRESETS[0]!);
    setDraftAttachments(clonePendingImages(annotation.attachments));
    setSelectedAnnotationId(annotation.parentId ?? annotation.id);
    setSidebarTab("annotations");
    seekTo(annotation.timestampMs / 1000);
  }

  function selectAnnotation(annotation: AnnotationRecord) {
    setSelectedAnnotationId(annotation.parentId ?? annotation.id);
    setSidebarTab("annotations");
    seekTo(annotation.timestampMs / 1000);
  }

  async function saveRating() {
    if (!mediaId || draftRating < 1 || draftRating > 5) return;
    setSavingRating(true);
    try {
      const response = await api<MediaResponse>(`/media/${mediaId}`, { method: "PATCH", body: JSON.stringify({ rating: draftRating }) });
      setMedia(response.media);
      setDraftRating(response.media.myRating ?? 0);
    } catch (e) {
      setAnnotationError(toZhError(e));
    } finally {
      setSavingRating(false);
    }
  }

  async function createAnnotation() {
    const cleanBody = composerBody.trim();
    if (!cleanBody && composerAttachments.length === 0) return;
    if (!mediaId) {
      setAnnotationError("未找到对应素材");
      return;
    }
    setComposerSubmitting(true);
    setAnnotationError(null);
    try {
      await api(`/media/${mediaId}/annotations`, {
        method: "POST",
        body: JSON.stringify({
          timestampMs: Math.max(0, Math.round(currentTime * 1000)),
          type: cleanBody ? "text" : "pin",
          body: cleanBody,
          color: composerColor,
          attachments: toAttachmentPayload(composerAttachments)
        })
      });
      const next = await reloadAnnotations();
      setSelectedAnnotationId(next.at(-1)?.id ?? null);
      setSidebarTab("annotations");
      resetComposer();
    } catch (e: any) {
      const detail = e?.data?.issues?.[0]?.message as string | undefined;
      setAnnotationError(detail ?? toZhError(e));
    } finally {
      setComposerSubmitting(false);
    }
  }

  async function submitDraft(targetAnnotation?: AnnotationRecord) {
    const cleanBody = draftBody.trim();
    if (!cleanBody && draftAttachments.length === 0) return;
    if (!mediaId || !draftMode) {
      setAnnotationError("未找到对应素材");
      return;
    }
    setDraftSubmitting(true);
    setAnnotationError(null);
    try {
      if (draftMode === "edit") {
        const editingTarget = targetAnnotation ?? flatAnnotations.find((item) => item.id === draftTargetId);
        if (!editingTarget || !draftTargetId) throw new Error("not_found");
        await api(`/annotations/${draftTargetId}`, {
          method: "PATCH",
          body: JSON.stringify({
            timestampMs: editingTarget.timestampMs,
            body: cleanBody,
            color: draftColor,
            attachments: toAttachmentPayload(draftAttachments)
          })
        });
      } else {
        await api(`/media/${mediaId}/annotations`, {
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
    setAnnotationError(null);
    try {
      await api(`/annotations/${annotationId}`, { method: "DELETE" });
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
      await api(`/annotations/${annotation.id}/completion`, {
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
    releasePendingImages(draftAttachments);
    setDraftMode("reply");
    setDraftTargetId(annotation.id);
    setDraftBody(getReplyPrefix(annotation));
    setDraftColor(annotation.color || COLOR_PRESETS[0]!);
    setDraftAttachments([]);
    setSidebarTab("annotations");
    setSelectedAnnotationId(annotation.id);
    seekTo(annotation.timestampMs / 1000);
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
    router.push(getWorkbenchBackHref());
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
          <button className="mr-btn mr-btn--primary" type="button" onClick={goBack}>返回工作台</button>
        </div>
      </main>
    );
  }

  return (
    <main className="mr-player-page">
      <div className="mr-player-page__layout">
        <section className="mr-player-page__main">
          <div className="mr-player-page__topbar">
            <button className="mr-btn mr-btn--primary" type="button" onClick={goBack}>返回工作台</button>
            <div className="mr-player-page__title-wrap">
              <div className="mr-player-page__eyebrow">Review player</div>
              <h1 className="mr-player-page__title">{media.title}</h1>
            </div>
          </div>

          <div
            className={`mr-player-page__video-shell${isFullscreen ? " mr-player-page__video-shell--fullscreen" : ""}${showUi ? " mr-player-page__video-shell--ui" : " mr-player-page__video-shell--ui-hidden"}`}
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
              <video ref={videoRef} key={previewUrl} src={previewUrl} autoPlay playsInline className="mr-player-page__video" />
            </div>
            <div className={`mr-player-page__overlay mr-player-page__overlay--top${showUi ? "" : " mr-player-page__overlay--hidden"}`}>
              <div className="mr-player-page__overlay-chip" onMouseEnter={keepUiVisible} onMouseLeave={resumeUiHide}>{timeDisplayValue}</div>
              <div className="mr-player-page__overlay-chip" onMouseEnter={keepUiVisible} onMouseLeave={resumeUiHide}>{annotations.length} 条标注</div>
            </div>
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
                          onClick={() => selectAnnotation(annotation)}
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
                    onMouseMove={handleTimelinePointer}
                    onMouseLeave={() => setHoverTime(null)}
                    onChange={(event) => seekTo(Number(event.target.value))}
                  />
                </div>
              </div>
              <div className="mr-player-page__controls">
                <div className="mr-player-page__control-group" onMouseEnter={keepUiVisible} onMouseLeave={resumeUiHide}>
                  <IconButton title={isPlaying ? "暂停" : "播放"} onClick={() => void togglePlayback()}>
                    <PlayerIcon>{isPlaying ? "❚❚" : "▶"}</PlayerIcon>
                  </IconButton>
                  <IconButton title="后退 5 秒" onClick={() => seekBy(-5)}>
                    <PlayerIcon>↺</PlayerIcon>
                  </IconButton>
                  <IconButton title="前进 5 秒 / 长按快进" onClick={() => seekBy(5)}>
                    <span
                      className="mr-player-page__long-press-proxy"
                      onMouseDown={beginFastSeek}
                      onMouseUp={endFastSeek}
                      onMouseLeave={endFastSeek}
                    >
                      <PlayerIcon>↻</PlayerIcon>
                    </span>
                  </IconButton>
                  <IconButton title="前一帧" onClick={() => stepFrame(-1)}>
                    <PlayerIcon>◀|</PlayerIcon>
                  </IconButton>
                  <IconButton title="后一帧" onClick={() => stepFrame(1)}>
                    <PlayerIcon>|▶</PlayerIcon>
                  </IconButton>
                </div>
                <div className="mr-player-page__control-group mr-player-page__control-group--right" onMouseEnter={keepUiVisible} onMouseLeave={resumeUiHide}>
                  <div className="mr-player-page__volume-wrap">
                    <IconButton title={muted ? "取消静音" : "静音"} onClick={toggleMute}>
                      <PlayerIcon>{muted || volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}</PlayerIcon>
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
                  <IconButton title="切换时间显示" onClick={openTimeDisplayDialog} active>
                    <PlayerIcon>{timeDisplayMode === "frame" ? "#" : timeDisplayMode === "remaining_total" ? "⌛" : "⏱"}</PlayerIcon>
                  </IconButton>
                  <IconButton title={pinUi ? "关闭 UI 常驻" : "开启 UI 常驻"} onClick={() => setPinUi((prev) => !prev)} active={pinUi}>
                    <PlayerIcon>📌</PlayerIcon>
                  </IconButton>
                  <IconButton title={isFullscreen ? "退出全屏" : "全屏"} onClick={() => void toggleFullscreen()}>
                    <PlayerIcon>{isFullscreen ? "🡼" : "⛶"}</PlayerIcon>
                  </IconButton>
                </div>
              </div>
            </div>
          </div>

          <section className={`mr-panel mr-player-page__composer${annotationEditorFullscreen ? " mr-player-page__composer--fullscreen" : ""}`}>
            <div className="mr-player-page__section-head">
              <div>
                <div className="mr-player-page__section-kicker">Annotation</div>
                <h2 className="mr-player-page__section-title">在当前时间创建标注</h2>
              </div>
              <div className="mr-player-page__composer-actions">
                <div className="mr-badge">{formatClock(currentTime)}</div>
                <button className="mr-btn" type="button" onClick={() => setShowShortcutDialog(true)}>快捷键</button>
                <button className="mr-btn" type="button" onClick={() => setAnnotationEditorFullscreen((prev) => !prev)}>{annotationEditorFullscreen ? "退出全屏编辑" : "全屏编辑"}</button>
              </div>
            </div>

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
                <button className="mr-btn" type="button" onClick={() => triggerAttachmentPicker("composer")}>{composerUploading ? "上传图片中…" : "插入图片"}</button>
                <input ref={attachmentInputRef} id="mr-player-page-attachment-input" type="file" accept="image/*" multiple hidden onChange={handleAttachmentInput} />
                <button
                  className="mr-btn mr-btn--primary"
                  type="button"
                  onClick={() => void createAnnotation()}
                  disabled={composerSubmitting || composerUploading || (!composerBody.trim() && composerAttachments.length === 0)}
                >
                  {composerSubmitting ? "创建中…" : "创建标注"}
                </button>
              </div>

              {annotationError ? <div className="mr-feedback mr-feedback--error">{annotationError}</div> : null}
            </div>
          </section>
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
                <div className="mr-project-meta mr-player-page__meta-row mr-player-page__rating-row">
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
                </div>
              </div>
            </div>
          ) : (
            <div className="mr-panel mr-player-page__sidebar-card mr-player-page__sidebar-card--scroll">
              <div className="mr-player-page__section-head">
                <div>
                  <div className="mr-player-page__section-kicker">Annotations</div>
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
                              <span className="mr-player-page__annotation-order" aria-hidden="true">{annotationNumber}</span>
                              <span className="mr-player-page__annotation-avatar">{displayName.slice(0, 1)}</span>
                              <span className="mr-player-page__annotation-author-block">
                                <span className="mr-player-page__annotation-author-row">
                                  <strong>{displayName}</strong>
                                  <span className="mr-badge">#{annotationNumber}</span>
                                  <span className="mr-badge">{formatClock(annotation.timestampMs / 1000)}</span>
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
                            >
                              {annotation.completedAt ? "✓" : "○"}
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
                              <div className="mr-player-page__annotation-body">{annotation.body || "（仅图片标注）"}</div>
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
                                        <span className="mr-player-page__annotation-avatar mr-player-page__annotation-avatar--reply">{replyName.slice(0, 1)}</span>
                                        <div className="mr-player-page__annotation-reply-body">
                                          <div className="mr-player-page__annotation-author-row">
                                            <strong>{replyName}</strong>
                                            <span className="mr-badge">#{replyNumber}</span>
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
                                              <PlayerIcon>↗</PlayerIcon>
                                            </IconButton>
                                            <IconButton title="编辑回复" onClick={() => openEditDraft(reply)}>
                                              <PlayerIcon>✎</PlayerIcon>
                                            </IconButton>
                                            <IconButton title="复制内容" onClick={() => void navigator.clipboard?.writeText(reply.body || "")} disabled={!reply.body}>
                                              <PlayerIcon>⧉</PlayerIcon>
                                            </IconButton>
                                            <IconButton title="删除回复" onClick={() => setDeleteTarget(reply)}>
                                              <PlayerIcon>🗑</PlayerIcon>
                                            </IconButton>
                                          </div>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                  {showReplyDraft ? (
                                    <div className="mr-player-page__annotation-reply mr-player-page__annotation-reply--draft">
                                      <span className="mr-player-page__annotation-avatar mr-player-page__annotation-avatar--reply">回</span>
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
                              <PlayerIcon>↗</PlayerIcon>
                            </IconButton>
                            <IconButton title="编辑标注" onClick={() => openEditDraft(annotation)}>
                              <PlayerIcon>✎</PlayerIcon>
                            </IconButton>
                            <IconButton title="回复标注" onClick={() => openReplyDraft(annotation)}>
                              <PlayerIcon>↳</PlayerIcon>
                            </IconButton>
                            <IconButton title="复制内容" onClick={() => void navigator.clipboard?.writeText(annotation.body || "")} disabled={!annotation.body}>
                              <PlayerIcon>⧉</PlayerIcon>
                            </IconButton>
                            <IconButton title="删除标注" onClick={() => setDeleteTarget(annotation)}>
                              <PlayerIcon>🗑</PlayerIcon>
                            </IconButton>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
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
        open={showTimeDisplayDialog}
        title="选择时间显示方式"
        description="切换顶部时间标签和播放器时间读数。"
        onClose={() => setShowTimeDisplayDialog(false)}
        footer={
          <button type="button" className="mr-btn mr-btn--primary" onClick={() => setShowTimeDisplayDialog(false)}>
            完成
          </button>
        }
      >
        <div className="mr-player-page__dialog-option-list">
          {TIME_DISPLAY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`mr-player-page__dialog-option${timeDisplayMode === option.value ? " mr-player-page__dialog-option--active" : ""}`}
              onClick={() => {
                setTimeDisplayMode(option.value);
                setShowTimeDisplayDialog(false);
              }}
            >
              <div>
                <strong>{option.label}</strong>
                <p>{option.description}</p>
              </div>
              <span className="mr-badge">{timeDisplayMode === option.value ? "当前" : "可选"}</span>
            </button>
          ))}
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
