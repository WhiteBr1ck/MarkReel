"use client";

import type { ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes, formatDuration } from "./workspaceMock";
import type { WorkspaceItem } from "./shell";

type PlayerAnnotationAttachment = {
  id?: string;
  kind: "image";
  objectKey: string;
  mimeType?: string;
  width?: number;
  height?: number;
  createdAt?: string;
};

type PlayerAnnotationAuthor = {
  id: string;
  username: string;
  displayName: string | null;
};

type PlayerAnnotation = {
  id: string;
  timestampMs: number;
  type: "pin" | "rect" | "text";
  body: string;
  color?: string | null;
  createdAt: string;
  updatedAt: string;
  author?: PlayerAnnotationAuthor;
  attachments: PlayerAnnotationAttachment[];
};

type CreateAnnotationInput = {
  timestampMs: number;
  type: "pin" | "text";
  body: string;
  color: string;
  attachments: PlayerAnnotationAttachment[];
};

type Props = {
  mediaId: string;
  title: string;
  previewUrl: string;
  item?: Extract<WorkspaceItem, { kind: "video" }> | null;
  onClose: () => void;
  loadAnnotations: (mediaId: string) => Promise<PlayerAnnotation[]>;
  createAnnotation: (mediaId: string, input: CreateAnnotationInput) => Promise<void>;
  uploadAttachment: (file: File) => Promise<PlayerAnnotationAttachment>;
};

type TimeDisplayMode = "current" | "total" | "remaining" | "frames";
type SidebarTab = "file" | "annotations";

const DISPLAY_MODE_LABEL: Record<TimeDisplayMode, string> = {
  current: "当前时间",
  total: "总时长",
  remaining: "剩余时长",
  frames: "帧数"
};

function formatFpsValue(frameCount?: number, durationSeconds?: number) {
  if (!frameCount || !durationSeconds || durationSeconds <= 0) return null;
  const fps = frameCount / durationSeconds;
  if (!Number.isFinite(fps) || fps <= 0) return null;
  const rounded = Math.round(fps * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

const COLOR_PRESETS = ["#c96442", "#d7a55a", "#5f8f64", "#5f85d6", "#9a68d8", "#d55f8d"];
const SPEEDS = [0.5, 1, 1.5, 2];

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

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN");
}

function formatAttachmentLabel(attachment: PlayerAnnotationAttachment) {
  const dims = attachment.width && attachment.height ? ` · ${attachment.width}×${attachment.height}` : "";
  return `${attachment.kind}${dims}`;
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

export function PlayerReview({ mediaId, title, previewUrl, item, onClose, loadAnnotations, createAnnotation, uploadAttachment }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [annotations, setAnnotations] = useState<PlayerAnnotation[]>([]);
  const [loadingAnnotations, setLoadingAnnotations] = useState(true);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item?.durationSeconds ?? 0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [timeDisplayMode, setTimeDisplayMode] = useState<TimeDisplayMode>("current");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("file");
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [color, setColor] = useState(COLOR_PRESETS[0]!);
  const [attachments, setAttachments] = useState<PlayerAnnotationAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingAnnotations(true);
    setAnnotationError(null);
    setSelectedAnnotationId(null);
    setBody("");
    setAttachments([]);
    void loadAnnotations(mediaId)
      .then((result) => {
        if (cancelled) return;
        setAnnotations(result);
      })
      .catch(() => {
        if (cancelled) return;
        setAnnotationError("标注列表加载失败");
        setAnnotations([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingAnnotations(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadAnnotations, mediaId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const currentVideo = video;

    function syncTime() {
      setCurrentTime(currentVideo.currentTime || 0);
      if (Number.isFinite(currentVideo.duration) && currentVideo.duration > 0) {
        setDuration(currentVideo.duration);
      }
    }

    function syncState() {
      setIsPlaying(!currentVideo.paused && !currentVideo.ended);
      setPlaybackRate(currentVideo.playbackRate || 1);
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
    document.addEventListener("fullscreenchange", syncFullscreen);

    return () => {
      currentVideo.removeEventListener("timeupdate", syncTime);
      currentVideo.removeEventListener("loadedmetadata", syncTime);
      currentVideo.removeEventListener("durationchange", syncTime);
      currentVideo.removeEventListener("play", syncState);
      currentVideo.removeEventListener("pause", syncState);
      currentVideo.removeEventListener("ratechange", syncState);
      document.removeEventListener("fullscreenchange", syncFullscreen);
    };
  }, [previewUrl]);

  const frameStepSeconds = useMemo(() => {
    const knownDuration = duration || item?.durationSeconds || 0;
    if (knownDuration > 0 && item?.frameCount && item.frameCount > 0) {
      return knownDuration / item.frameCount;
    }
    return 1 / 24;
  }, [duration, item?.durationSeconds, item?.frameCount]);

  const currentFrame = useMemo(() => {
    if (!item?.frameCount || frameStepSeconds <= 0) return null;
    return clamp(Math.floor(currentTime / frameStepSeconds) + 1, 1, item.frameCount);
  }, [currentTime, frameStepSeconds, item?.frameCount]);

  const timeDisplayValue = useMemo(() => {
    if (timeDisplayMode === "total") return `总 ${formatClock(duration)}`;
    if (timeDisplayMode === "remaining") return `余 ${formatClock(Math.max(0, duration - currentTime))}`;
    if (timeDisplayMode === "frames") {
      if (!item?.frameCount || currentFrame == null) return "帧数未知";
      return `${currentFrame} / ${item.frameCount} 帧`;
    }
    return `${formatClock(currentTime)} / ${formatClock(duration)}`;
  }, [currentFrame, currentTime, duration, item?.frameCount, timeDisplayMode]);

  const fpsLabel = useMemo(() => {
    const value = formatFpsValue(item?.frameCount, duration || item?.durationSeconds);
    return value ? `${value} FPS` : "未知";
  }, [duration, item?.durationSeconds, item?.frameCount]);

  const annotationCountLabel = `${annotations.length} 条标注`;

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
    const video = videoRef.current;
    if (!video) return;
    const wrapper = video.closest(".mr-review__video-shell") as HTMLElement | null;
    if (!document.fullscreenElement) {
      await wrapper?.requestFullscreen?.();
      return;
    }
    await document.exitFullscreen();
  }

  function cycleSpeed() {
    const video = videoRef.current;
    if (!video) return;
    const index = SPEEDS.indexOf(playbackRate);
    const next = SPEEDS[(index + 1) % SPEEDS.length] ?? 1;
    video.playbackRate = next;
    setPlaybackRate(next);
  }

  function cycleTimeDisplayMode() {
    const order: TimeDisplayMode[] = ["current", "total", "remaining", "frames"];
    const index = order.indexOf(timeDisplayMode);
    setTimeDisplayMode(order[(index + 1) % order.length] ?? "current");
  }

  async function handleAttachmentInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(
        files.map(async (file) => {
          const imageSize = await getImageSize(file);
          const base = await uploadAttachment(file);
          return { ...base, ...imageSize, mimeType: file.type || base.mimeType };
        })
      );
      setAttachments((prev) => [...prev, ...uploaded]);
    } finally {
      setUploading(false);
      event.currentTarget.value = "";
    }
  }

  async function handleCreateAnnotation() {
    const cleanBody = body.trim();
    if (!cleanBody && attachments.length === 0) return;
    setSubmitting(true);
    try {
      await createAnnotation(mediaId, {
        timestampMs: Math.max(0, Math.round(currentTime * 1000)),
        type: cleanBody ? "text" : "pin",
        body: cleanBody,
        color,
        attachments
      });
      const next = await loadAnnotations(mediaId);
      setAnnotations(next);
      const latest = next.at(-1) ?? null;
      setSelectedAnnotationId(latest?.id ?? null);
      setSidebarTab("annotations");
      setBody("");
      setAttachments([]);
    } catch {
      setAnnotationError("创建标注失败");
    } finally {
      setSubmitting(false);
    }
  }

  function selectAnnotation(annotation: PlayerAnnotation) {
    setSelectedAnnotationId(annotation.id);
    setSidebarTab("annotations");
    seekTo(annotation.timestampMs / 1000);
  }

  return (
    <div className="mr-review">
      <div className="mr-panel mr-review__layout">
        <div className="mr-review__main">
          <div className="mr-review__header">
            <div>
              <div className="mr-review__eyebrow">Review player</div>
              <h2 className="mr-review__title">{title}</h2>
              <div className="mr-review__subline">{annotationCountLabel}</div>
            </div>
            <div className="mr-review__actions">
              <button className="mr-btn" type="button" onClick={cycleTimeDisplayMode} title={DISPLAY_MODE_LABEL[timeDisplayMode]}>
                {timeDisplayValue}
              </button>
              <button className="mr-btn mr-btn--surface" type="button" onClick={onClose}>
                返回工作台
              </button>
            </div>
          </div>

          <div className="mr-review__video-shell">
            <video ref={videoRef} key={previewUrl} src={previewUrl} autoPlay playsInline className="mr-review__video" />
          </div>

          <div className="mr-review__controls">
            <div className="mr-review__control-row">
              <button className="mr-btn mr-btn--primary" type="button" onClick={() => void togglePlayback()}>
                {isPlaying ? "暂停" : "播放"}
              </button>
              <button className="mr-btn" type="button" onClick={() => seekBy(-5)}>
                后退 5 秒
              </button>
              <button className="mr-btn" type="button" onClick={() => seekBy(5)}>
                前进 5 秒
              </button>
              <button className="mr-btn" type="button" onClick={() => stepFrame(-1)}>
                前一帧
              </button>
              <button className="mr-btn" type="button" onClick={() => stepFrame(1)}>
                后一帧
              </button>
              <button className="mr-btn" type="button" onClick={cycleSpeed}>
                {playbackRate}x
              </button>
              <button className="mr-btn" type="button" onClick={() => void toggleFullscreen()}>
                {isFullscreen ? "退出全屏" : "全屏"}
              </button>
            </div>

            <div className="mr-review__timeline-wrap">
              <input
                className="mr-review__timeline"
                type="range"
                min={0}
                max={Math.max(duration, 0.001)}
                step="0.01"
                value={Math.min(currentTime, duration || currentTime)}
                onChange={(event) => seekTo(Number(event.target.value))}
              />
              <div className="mr-review__markers">
                {annotations.map((annotation) => {
                  const left = duration > 0 ? `${(annotation.timestampMs / 1000 / duration) * 100}%` : "0%";
                  return (
                    <button
                      key={annotation.id}
                      type="button"
                      className={`mr-review__marker${selectedAnnotationId === annotation.id ? " mr-review__marker--active" : ""}`}
                      style={{ left, background: annotation.color || color }}
                      title={`${formatClock(annotation.timestampMs / 1000)} ${annotation.body || "标注"}`}
                      onClick={() => selectAnnotation(annotation)}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mr-panel mr-review__composer">
            <div className="mr-review__section-head">
              <div>
                <div className="mr-review__section-kicker">Annotation</div>
                <h3 className="mr-review__section-title">在当前时间创建标注</h3>
              </div>
              <div className="mr-badge">{formatClock(currentTime)}</div>
            </div>

            <textarea
              className="mr-input mr-review__textarea"
              placeholder="输入批注内容，可只上传图片不写文字。"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={4}
            />

            <div className="mr-review__composer-row">
              <div className="mr-review__swatches">
                {COLOR_PRESETS.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    className={`mr-review__swatch${color === swatch ? " mr-review__swatch--active" : ""}`}
                    style={{ background: swatch }}
                    onClick={() => setColor(swatch)}
                    aria-label={`颜色 ${swatch}`}
                  />
                ))}
              </div>
              <label className="mr-btn" htmlFor="mr-review-attachment-input">
                {uploading ? "上传图片中…" : "插入图片"}
              </label>
              <input id="mr-review-attachment-input" type="file" accept="image/*" multiple hidden onChange={handleAttachmentInput} />
              <button className="mr-btn mr-btn--primary" type="button" onClick={() => void handleCreateAnnotation()} disabled={submitting || uploading || (!body.trim() && attachments.length === 0)}>
                {submitting ? "保存中…" : "创建标注"}
              </button>
            </div>

            {attachments.length > 0 ? (
              <div className="mr-review__attachment-list">
                {attachments.map((attachment, index) => (
                  <div key={`${attachment.objectKey}-${index}`} className="mr-review__attachment-chip">
                    <span>{formatAttachmentLabel(attachment)}</span>
                    <button className="mr-review__attachment-remove" type="button" onClick={() => setAttachments((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {annotationError ? <div className="mr-feedback mr-feedback--error">{annotationError}</div> : null}
          </div>
        </div>

        <aside className="mr-review__sidebar">
          <div className="mr-review__tabs">
            <button className={`mr-btn mr-btn--surface${sidebarTab === "file" ? " mr-btn--primary" : ""}`} type="button" onClick={() => setSidebarTab("file")}>
              文件信息
            </button>
            <button className={`mr-btn mr-btn--surface${sidebarTab === "annotations" ? " mr-btn--primary" : ""}`} type="button" onClick={() => setSidebarTab("annotations")}>
              标注信息
            </button>
          </div>

          {sidebarTab === "file" ? (
            <div className="mr-panel mr-review__sidebar-card">
              <div className="mr-review__meta-grid">
                <div className="mr-project-meta"><span>标题</span><strong>{title}</strong></div>
                <div className="mr-project-meta"><span>时长</span><strong>{formatDuration(duration || item?.durationSeconds)}</strong></div>
                <div className="mr-project-meta"><span>分辨率</span><strong>{item?.width && item?.height ? `${item.width}×${item.height}` : "未知"}</strong></div>
                <div className="mr-project-meta"><span>FPS</span><strong>{fpsLabel}</strong></div>
                <div className="mr-project-meta"><span>码率</span><strong>{item?.bitrateKbps ? `${item.bitrateKbps} kbps` : "未知"}</strong></div>
                <div className="mr-project-meta"><span>大小</span><strong>{formatBytes(item?.sizeBytes)}</strong></div>
                <div className="mr-project-meta"><span>状态</span><strong>{item?.status ?? "ready"}</strong></div>
              </div>
            </div>
          ) : (
            <div className="mr-panel mr-review__sidebar-card">
              <div className="mr-review__section-head">
                <div>
                  <div className="mr-review__section-kicker">Annotations</div>
                  <h3 className="mr-review__section-title">时间顺序</h3>
                </div>
                <div className="mr-badge">{annotations.length}</div>
              </div>

              {loadingAnnotations ? (
                <div className="mr-review__empty">正在加载标注…</div>
              ) : annotations.length === 0 ? (
                <div className="mr-review__empty">还没有标注，先在下方创建第一条。</div>
              ) : (
                <div className="mr-review__annotation-list">
                  {annotations.map((annotation) => (
                    <button
                      key={annotation.id}
                      type="button"
                      className={`mr-review__annotation-item${selectedAnnotationId === annotation.id ? " mr-review__annotation-item--active" : ""}`}
                      onClick={() => selectAnnotation(annotation)}
                    >
                      <div className="mr-review__annotation-head">
                        <span className="mr-review__annotation-dot" style={{ background: annotation.color || color }} />
                        <strong>{formatClock(annotation.timestampMs / 1000)}</strong>
                        <span className="mr-badge">{annotation.type}</span>
                      </div>
                      <div className="mr-review__annotation-body">{annotation.body || "（仅图片标注）"}</div>
                      <div className="mr-review__annotation-meta">
                        <span>{annotation.author?.displayName ?? annotation.author?.username ?? "未知用户"}</span>
                        <span>{formatDateTime(annotation.createdAt)}</span>
                      </div>
                      {annotation.attachments.length > 0 ? (
                        <div className="mr-review__annotation-attachments">
                          {annotation.attachments.map((attachment, index) => (
                            <span key={`${attachment.objectKey}-${index}`} className="mr-badge">
                              {formatAttachmentLabel(attachment)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
