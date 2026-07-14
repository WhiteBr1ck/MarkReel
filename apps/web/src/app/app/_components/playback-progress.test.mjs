import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  clearAllStoredPlaybackProgress,
  clearStoredPlaybackProgress,
  getStoredPlaybackProgress,
  isPlaybackComplete,
  saveStoredPlaybackProgress
} from "./playback-progress.ts";

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }

  removeItem(key) {
    this.values.delete(key);
  }

  clear() {
    this.values.clear();
  }
}

const localStorage = new MemoryStorage();
Object.defineProperty(globalThis, "window", { value: { localStorage }, configurable: true });

beforeEach(() => localStorage.clear());

test("stores and restores unfinished playback progress", () => {
  saveStoredPlaybackProgress("media:one", 123.4, 600);
  assert.equal(getStoredPlaybackProgress("media:one", 600), 123.4);
});

test("treats playback near the end as complete", () => {
  assert.equal(isPlaybackComplete(596, 600), true);
  saveStoredPlaybackProgress("media:one", 596, 600);
  assert.equal(getStoredPlaybackProgress("media:one", 600), null);
});

test("clears one item or all saved progress", () => {
  saveStoredPlaybackProgress("media:one", 120, 600);
  saveStoredPlaybackProgress("media:two", 240, 600);
  clearStoredPlaybackProgress("media:one");
  assert.equal(getStoredPlaybackProgress("media:one", 600), null);
  assert.equal(getStoredPlaybackProgress("media:two", 600), 240);
  clearAllStoredPlaybackProgress();
  assert.equal(getStoredPlaybackProgress("media:two", 600), null);
});
