import { useEffect, useRef, useState } from "react";
import { IconX } from "@tabler/icons-react";
import type { PlaybackEventStats } from "./playback-diagnostics-events";
import {
  collectPlaybackDiagnostics,
  type PlaybackDiagnosticsSnapshot,
  type PlaybackMediaMetadata,
  type PlaybackSample
} from "./playback-diagnostics-snapshot";

type PlaybackDiagnosticsOverlayProps = {
  readonly open: boolean;
  readonly videoRef: { readonly current: HTMLVideoElement | null };
  readonly previewUrl: string;
  readonly mediaMetadata?: PlaybackMediaMetadata | null;
  readonly eventStatsRef: { readonly current: PlaybackEventStats };
  readonly onClose: () => void;
  readonly onMouseEnter?: () => void;
  readonly onMouseLeave?: () => void;
};

export function PlaybackDiagnosticsOverlay({
  open,
  videoRef,
  previewUrl,
  mediaMetadata,
  eventStatsRef,
  onClose,
  onMouseEnter,
  onMouseLeave
}: PlaybackDiagnosticsOverlayProps) {
  const previousSampleRef = useRef<PlaybackSample | null>(null);
  const [snapshot, setSnapshot] = useState<PlaybackDiagnosticsSnapshot | null>(null);

  useEffect(() => {
    if (!open) {
      previousSampleRef.current = null;
      return;
    }
    function refresh() {
      const next = collectPlaybackDiagnostics({
        video: videoRef.current,
        previewUrl,
        mediaMetadata,
        eventStats: eventStatsRef.current,
        previousSample: previousSampleRef.current
      });
      previousSampleRef.current = next.sample;
      setSnapshot(next);
    }
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [eventStatsRef, mediaMetadata, open, previewUrl, videoRef]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="mr-player-page__stats-overlay"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="mr-player-page__stats-head">
        <div>
          <strong>统计信息</strong>
        </div>
        <button className="mr-player-page__stats-close" type="button" onClick={onClose} aria-label="关闭视频详细信息">
          <IconX size={17} stroke={1.8} aria-hidden="true" />
        </button>
      </div>
      <div className="mr-player-page__stats-grid" aria-live="polite">
        {(snapshot?.rows ?? [{ label: "状态", value: "正在采集" }]).map((row) => (
          <div className="mr-player-page__stats-row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
