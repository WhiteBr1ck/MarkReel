type PlaybackProgressRecord = {
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: number;
};

type PlaybackProgressStore = Record<string, PlaybackProgressRecord>;

const STORAGE_KEY = "mr_playback_progress";
const MAX_STORED_PROGRESS_ITEMS = 200;

function readStore(): PlaybackProgressStore {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as PlaybackProgressStore;
  } catch {
    return {};
  }
}

function writeStore(store: PlaybackProgressStore) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    return;
  }
}

function completionThreshold(durationSeconds: number) {
  return Math.min(5, Math.max(0.5, durationSeconds * 0.02));
}

export function isPlaybackComplete(positionSeconds: number, durationSeconds: number) {
  return durationSeconds > 0 && durationSeconds - positionSeconds <= completionThreshold(durationSeconds);
}

export function getStoredPlaybackProgress(key: string, durationSeconds: number) {
  if (!key) return null;
  const record = readStore()[key];
  if (!record || !Number.isFinite(record.positionSeconds) || record.positionSeconds < 1) return null;
  if (isPlaybackComplete(record.positionSeconds, durationSeconds || record.durationSeconds)) {
    clearStoredPlaybackProgress(key);
    return null;
  }
  return record.positionSeconds;
}

export function saveStoredPlaybackProgress(key: string, positionSeconds: number, durationSeconds: number) {
  if (!key || !Number.isFinite(positionSeconds) || positionSeconds < 1) return;
  if (isPlaybackComplete(positionSeconds, durationSeconds)) {
    clearStoredPlaybackProgress(key);
    return;
  }

  const store = readStore();
  store[key] = {
    positionSeconds: Math.round(positionSeconds * 10) / 10,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
    updatedAt: Date.now()
  };

  const entries = Object.entries(store).sort((left, right) => right[1].updatedAt - left[1].updatedAt);
  writeStore(Object.fromEntries(entries.slice(0, MAX_STORED_PROGRESS_ITEMS)));
}

export function clearStoredPlaybackProgress(key: string) {
  if (!key) return;
  const store = readStore();
  if (!(key in store)) return;
  delete store[key];
  writeStore(store);
}

export function clearAllStoredPlaybackProgress() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
}
