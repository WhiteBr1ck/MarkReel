import type { PlaybackEventStats } from "./playback-diagnostics-events";

type BrowserConnection = {
  readonly effectiveType?: string;
  readonly downlink?: number;
  readonly rtt?: number;
  readonly saveData?: boolean;
};

type BrowserNavigator = Navigator & {
  readonly connection?: BrowserConnection;
  readonly deviceMemory?: number;
};

type VideoMetricsElement = HTMLVideoElement & {
  readonly webkitDecodedFrameCount?: number;
  readonly webkitDroppedFrameCount?: number;
};

export type PlaybackSample = {
  readonly observedAtMs: number;
  readonly currentTime: number;
  readonly bufferedEnd: number;
  readonly totalVideoFrames: number | null;
};

export type PlaybackMediaMetadata = {
  readonly durationMs?: number | null;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly bitrateKbps?: number | null;
  readonly frameCount?: number | null;
  readonly formatName?: string | null;
  readonly videoCodec?: string | null;
  readonly videoProfile?: string | null;
  readonly videoPixelFormat?: string | null;
  readonly videoFrameRate?: number | null;
  readonly videoBitrateKbps?: number | null;
  readonly audioCodec?: string | null;
  readonly audioBitrateKbps?: number | null;
};

export type PlaybackDiagnosticsRow = {
  readonly label: string;
  readonly value: string;
};

export type PlaybackDiagnosticsSnapshot = {
  readonly rows: readonly PlaybackDiagnosticsRow[];
  readonly sample: PlaybackSample;
};

export type PlaybackDiagnosticsInput = {
  readonly video: HTMLVideoElement | null;
  readonly previewUrl: string;
  readonly mediaMetadata?: PlaybackMediaMetadata | null;
  readonly eventStats: PlaybackEventStats;
  readonly previousSample: PlaybackSample | null;
};

export function collectPlaybackDiagnostics(input: PlaybackDiagnosticsInput): PlaybackDiagnosticsSnapshot {
  const observedAtMs = Date.now();
  const video = input.video;
  if (!video) {
    return {
      rows: [{ label: "State", value: "video element not ready" }],
      sample: { observedAtMs, currentTime: 0, bufferedEnd: 0, totalVideoFrames: null }
    };
  }
  const metadata = input.mediaMetadata;
  const quality = readFrameQuality(video);
  const bufferedEnd = findBufferedEnd(video.buffered, video.currentTime);
  const sample = { observedAtMs, currentTime: video.currentTime || 0, bufferedEnd, totalVideoFrames: quality.total };
  const bufferAhead = Math.max(0, bufferedEnd - sample.currentTime);
  const actualFps = estimatePlaybackFps(input.previousSample, sample, video.paused || video.ended);
  const sourceFps = metadata?.videoFrameRate ?? deriveFrameRate(metadata);
  const throughput = estimateThroughput(input.previousSample, sample, metadata?.bitrateKbps, video);
  return {
    rows: [
      { label: "地址", value: formatAddress(video.currentSrc || input.previewUrl) },
      { label: "容器格式", value: formatContainer(metadata?.formatName, video.currentSrc || input.previewUrl) },
      { label: "编解码器", value: formatCodecs(metadata) },
      { label: "视频编码格式", value: formatVideoEncoding(metadata) },
      { label: "视频本身", value: formatSourceVideo(metadata, sourceFps) },
      { label: "当前实际播放", value: formatActualPlayback(video, actualFps) },
      { label: "视频码率", value: formatVideoBitrate(metadata) },
      { label: "音频码率", value: formatBitrate(metadata?.audioBitrateKbps) },
      { label: "缓冲时长", value: `${formatDuration(bufferAhead)}，至 ${formatClock(bufferedEnd)}` },
      { label: "网络信息", value: `${connectionLabel()}，${networkStateLabel(video.networkState)}` },
      { label: "下载速度", value: throughput },
      { label: "丢帧", value: formatFrameQuality(quality) },
      { label: "播放状态", value: `${playStateLabel(video)}，${readyStateLabel(video.readyState)}` },
      { label: "媒体事件", value: `${eventSummary(input.eventStats)}，${lastEventLabel(input.eventStats, observedAtMs)}` },
      { label: "错误", value: mediaErrorLabel(video.error) }
    ],
    sample
  };
}

function findBufferedEnd(ranges: TimeRanges, currentTime: number): number {
  let end = 0;
  for (let index = 0; index < ranges.length; index += 1) {
    const start = ranges.start(index);
    const rangeEnd = ranges.end(index);
    if (currentTime >= start && currentTime <= rangeEnd) return rangeEnd;
    end = Math.max(end, rangeEnd);
  }
  return end;
}

function formatAddress(value: string): string {
  if (!value) return "尚未加载";
  try {
    const url = new URL(value, window.location.href);
    return `${url.host}${decodeURIComponent(url.pathname)}`;
  } catch {
    return value;
  }
}

function readFrameQuality(video: HTMLVideoElement) {
  const quality = video.getVideoPlaybackQuality?.();
  const metricsVideo: VideoMetricsElement = video;
  const total = quality?.totalVideoFrames ?? metricsVideo.webkitDecodedFrameCount ?? null;
  const dropped = quality?.droppedVideoFrames ?? metricsVideo.webkitDroppedFrameCount ?? null;
  return { total, dropped };
}

function formatFrameQuality(quality: { total: number | null; dropped: number | null }): string {
  if (quality.total == null || quality.dropped == null) return "浏览器未提供";
  const rate = quality.total > 0 ? `${((quality.dropped / quality.total) * 100).toFixed(2)}%` : "0.00%";
  return `${quality.dropped} / ${quality.total}，${rate}`;
}

function estimatePlaybackFps(previous: PlaybackSample | null, current: PlaybackSample, stopped: boolean): number | null {
  if (stopped) return 0;
  if (!previous || previous.totalVideoFrames == null || current.totalVideoFrames == null) return null;
  const wallSeconds = (current.observedAtMs - previous.observedAtMs) / 1000;
  if (wallSeconds <= 0) return null;
  return Math.max(0, (current.totalVideoFrames - previous.totalVideoFrames) / wallSeconds);
}

function estimateThroughput(previous: PlaybackSample | null, current: PlaybackSample, bitrateKbps: number | null | undefined, video: HTMLVideoElement): string {
  if (!previous || !bitrateKbps || bitrateKbps <= 0) return "等待有效采样";
  const wallSeconds = (current.observedAtMs - previous.observedAtMs) / 1000;
  const mediaSeconds = current.bufferedEnd - previous.bufferedEnd;
  if (wallSeconds <= 0) return "等待有效采样";
  if (mediaSeconds <= 0.05) {
    if (video.networkState === HTMLMediaElement.NETWORK_IDLE && current.bufferedEnd >= video.duration - 0.1) return "已完成缓冲";
    return video.networkState === HTMLMediaElement.NETWORK_LOADING ? "等待新增缓冲" : "当前无下载";
  }
  return `约 ${((mediaSeconds / wallSeconds) * bitrateKbps / 1000).toFixed(2)} Mbps`;
}

function connectionLabel(): string {
  if (typeof navigator === "undefined") return "浏览器未提供";
  const nav: BrowserNavigator = navigator;
  const connection = nav.connection;
  if (!connection) return "浏览器未提供链路信息";
  const parts = [connection.effectiveType?.toUpperCase()];
  if (connection.downlink) parts.push(`${connection.downlink} Mbps`);
  if (connection.rtt) parts.push(`RTT ${connection.rtt} ms`);
  if (connection.saveData) parts.push("省流模式");
  return parts.filter(Boolean).join("，") || "浏览器未提供链路信息";
}

function eventSummary(stats: PlaybackEventStats): string {
  return `等待 ${stats.counts.waiting}，停滞 ${stats.counts.stalled}，错误 ${stats.counts.error}`;
}

function lastEventLabel(stats: PlaybackEventStats, nowMs: number): string {
  if (!stats.lastEvent || !stats.lastEventAtMs) return "暂无事件";
  return `最近 ${stats.lastEvent}，${Math.max(0, Math.round((nowMs - stats.lastEventAtMs) / 1000))} 秒前`;
}

function readyStateLabel(value: number): string {
  if (value === HTMLMediaElement.HAVE_NOTHING) return "无媒体数据";
  if (value === HTMLMediaElement.HAVE_METADATA) return "已有元数据";
  if (value === HTMLMediaElement.HAVE_CURRENT_DATA) return "已有当前帧";
  if (value === HTMLMediaElement.HAVE_FUTURE_DATA) return "可继续播放";
  if (value === HTMLMediaElement.HAVE_ENOUGH_DATA) return "数据充足";
  return String(value);
}

function networkStateLabel(value: number): string {
  if (value === HTMLMediaElement.NETWORK_EMPTY) return "网络未初始化";
  if (value === HTMLMediaElement.NETWORK_IDLE) return "网络空闲";
  if (value === HTMLMediaElement.NETWORK_LOADING) return "正在下载";
  if (value === HTMLMediaElement.NETWORK_NO_SOURCE) return "无可用媒体源";
  return String(value);
}

function playStateLabel(video: HTMLVideoElement): string {
  if (video.ended) return "播放结束";
  if (video.seeking) return `正在定位，${video.playbackRate}x`;
  if (video.paused) return `已暂停，${video.playbackRate}x`;
  return `播放中，${video.playbackRate}x`;
}

function mediaErrorLabel(error: MediaError | null): string {
  if (!error) return "无";
  if (error.code === MediaError.MEDIA_ERR_ABORTED) return "1 MEDIA_ERR_ABORTED";
  if (error.code === MediaError.MEDIA_ERR_NETWORK) return "2 MEDIA_ERR_NETWORK";
  if (error.code === MediaError.MEDIA_ERR_DECODE) return "3 MEDIA_ERR_DECODE";
  if (error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) return "4 MEDIA_ERR_SRC_NOT_SUPPORTED";
  return String(error.code);
}

function formatContainer(value: string | null | undefined, address: string): string {
  const lower = value?.toLowerCase() ?? "";
  if (lower.includes("matroska") || lower.includes("webm")) return "Matroska / WebM";
  if (lower.includes("mov") || lower.includes("mp4")) return "MP4 / QuickTime";
  if (lower.includes("avi")) return "AVI";
  if (lower.includes("mpegts")) return "MPEG TS";
  if (lower) return value ?? "未知";
  const extension = address.split(/[?#]/, 1)[0]?.split(".").pop()?.toUpperCase();
  return extension && extension.length <= 5 ? extension : "未知";
}

function formatCodecs(metadata?: PlaybackMediaMetadata | null): string {
  const video = metadata?.videoCodec ? `视频 ${metadata.videoCodec}` : "视频未知";
  const audio = metadata?.audioCodec ? `音频 ${metadata.audioCodec}` : "音频未知";
  return `${video}，${audio}`;
}

function formatVideoEncoding(metadata?: PlaybackMediaMetadata | null): string {
  if (!metadata?.videoCodec) return "未知";
  return [friendlyVideoCodec(metadata.videoCodec), metadata.videoProfile, metadata.videoPixelFormat].filter(Boolean).join(" · ");
}

function friendlyVideoCodec(codec: string): string {
  const names: Record<string, string> = {
    h264: "H.264 / AVC",
    hevc: "H.265 / HEVC",
    av1: "AV1",
    vp9: "VP9",
    vp8: "VP8",
    prores: "Apple ProRes",
    mpeg4: "MPEG-4 Video"
  };
  return names[codec.toLowerCase()] ?? codec.toUpperCase();
}

function deriveFrameRate(metadata?: PlaybackMediaMetadata | null): number | null {
  if (!metadata?.frameCount || !metadata.durationMs || metadata.durationMs <= 0) return null;
  const fps = metadata.frameCount / (metadata.durationMs / 1000);
  return Number.isFinite(fps) && fps > 0 ? fps : null;
}

function formatSourceVideo(metadata: PlaybackMediaMetadata | null | undefined, fps: number | null): string {
  const resolution = metadata?.width && metadata.height ? `${metadata.width}×${metadata.height}` : "分辨率未知";
  return `${resolution} @ ${formatFps(fps)}`;
}

function formatActualPlayback(video: HTMLVideoElement, fps: number | null): string {
  const resolution = video.videoWidth && video.videoHeight ? `${video.videoWidth}×${video.videoHeight}` : "分辨率未知";
  return `${resolution} @ ${formatFps(fps)}`;
}

function formatFps(value: number | null): string {
  if (value == null) return "FPS 采样中";
  return `${value.toFixed(1)} FPS`;
}

function formatVideoBitrate(metadata?: PlaybackMediaMetadata | null): string {
  if (metadata?.videoBitrateKbps) return formatBitrate(metadata.videoBitrateKbps);
  if (metadata?.bitrateKbps) return `${formatBitrate(metadata.bitrateKbps)}，总码率`;
  return "未知";
}

function formatBitrate(value: number | null | undefined): string {
  if (!value || value <= 0) return "未知";
  return value >= 1000 ? `${(value / 1000).toFixed(2)} Mbps` : `${Math.round(value)} Kbps`;
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "未知";
  return `${value.toFixed(2)} 秒`;
}

function formatClock(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "未知";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}
