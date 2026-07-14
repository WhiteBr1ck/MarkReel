import assert from "node:assert/strict";
import test from "node:test";
import { parseByteRange, VIDEO_RANGE_CHUNK_BYTES } from "./objectResponse";

test("caps open ended video byte ranges", () => {
  const total = VIDEO_RANGE_CHUNK_BYTES * 4;
  assert.deepEqual(parseByteRange("bytes=1024-", total, VIDEO_RANGE_CHUNK_BYTES), {
    start: 1024,
    end: 1024 + VIDEO_RANGE_CHUNK_BYTES - 1
  });
});

test("preserves explicit and suffix byte ranges", () => {
  assert.deepEqual(parseByteRange("bytes=100-199", 1000, VIDEO_RANGE_CHUNK_BYTES), { start: 100, end: 199 });
  assert.deepEqual(parseByteRange("bytes=-200", 1000, VIDEO_RANGE_CHUNK_BYTES), { start: 800, end: 999 });
});

test("clamps the final open ended range to the object size", () => {
  assert.deepEqual(parseByteRange("bytes=900-", 1000, VIDEO_RANGE_CHUNK_BYTES), { start: 900, end: 999 });
  assert.equal(parseByteRange("bytes=1000-", 1000, VIDEO_RANGE_CHUNK_BYTES), null);
});
