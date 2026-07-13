export const PLAYBACK_EVENT_NAMES = [
  "loadstart",
  "loadedmetadata",
  "progress",
  "waiting",
  "stalled",
  "suspend",
  "canplay",
  "canplaythrough",
  "playing",
  "seeking",
  "seeked",
  "play",
  "pause",
  "ended",
  "ratechange",
  "volumechange",
  "error"
] as const;

export type PlaybackEventName = (typeof PLAYBACK_EVENT_NAMES)[number];

export type PlaybackEventStats = {
  readonly counts: Readonly<Record<PlaybackEventName, number>>;
  readonly lastEvent: PlaybackEventName | null;
  readonly lastEventAtMs: number | null;
};

export function createPlaybackEventStats(): PlaybackEventStats {
  return {
    counts: {
      loadstart: 0,
      loadedmetadata: 0,
      progress: 0,
      waiting: 0,
      stalled: 0,
      suspend: 0,
      canplay: 0,
      canplaythrough: 0,
      playing: 0,
      seeking: 0,
      seeked: 0,
      play: 0,
      pause: 0,
      ended: 0,
      ratechange: 0,
      volumechange: 0,
      error: 0
    },
    lastEvent: null,
    lastEventAtMs: null
  };
}

export function recordPlaybackEvent(stats: PlaybackEventStats, eventName: PlaybackEventName): PlaybackEventStats {
  return {
    counts: {
      ...stats.counts,
      [eventName]: stats.counts[eventName] + 1
    },
    lastEvent: eventName,
    lastEventAtMs: Date.now()
  };
}
