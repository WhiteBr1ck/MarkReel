import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { selectWorkspaceItems, WORKSPACE_PAGE_SIZE, workspacePage } from "./workspace-items-model.ts";

export function mediaFixture(count) {
  return Array.from({ length: count }, (_, i) => ({ id: `media-${i}`, kind: "video", name: `素材_${String(i).padStart(4, "0")}.mov`, updatedAt: i, sizeBytes: 30_000_000_000, durationSeconds: 600, width: 3840, height: 2160, frameCount: 14400, bitrateKbps: 400000 }));
}

test("filtering and sorting do not mutate API data", () => {
  const source = mediaFixture(1000);
  const original = source.map((item) => item.id);
  assert.equal(selectWorkspaceItems(source, "0999", "name_asc")[0].id, "media-999");
  assert.equal(selectWorkspaceItems(source, "", "updated_desc")[0].id, "media-999");
  assert.equal(selectWorkspaceItems(source, "", "name_desc")[0].id, "media-999");
  assert.deepEqual(source.map((item) => item.id), original);
});

test("all 1000 assets remain reachable while each render is bounded at 100", () => {
  const source = mediaFixture(1000);
  const reached = new Set();
  for (let page = 0; page < 10; page += 1) {
    const result = workspacePage(source, page);
    assert.equal(result.items.length, WORKSPACE_PAGE_SIZE);
    result.items.forEach((item) => reached.add(item.id));
  }
  assert.equal(reached.size, 1000);
  assert.equal(workspacePage(source.slice(0, 101), 9).page, 1);
  assert.deepEqual(workspacePage([], 9), { page: 0, pages: 1, items: [] });
});

for (const count of [100, 1000]) {
  test(`${count} assets: filter/sort/page performance baseline`, (t) => {
    const source = mediaFixture(count);
    const times = [];
    for (let i = 0; i < 100; i += 1) {
      const start = performance.now();
      const selected = selectWorkspaceItems(source, i % 2 ? "素材" : "", "name_desc");
      const page = workspacePage(selected, i % 10);
      assert.ok(page.items.length <= 100);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    t.diagnostic(JSON.stringify({ count, iterations: times.length, medianMs: +times[50].toFixed(3), p95Ms: +times[95].toFixed(3), renderedItemLimit: WORKSPACE_PAGE_SIZE }));
    // A loose guard catches accidental quadratic work without claiming browser FPS.
    assert.ok(times[95] < 100, `p95 ${times[95]}ms exceeds the computation budget`);
  });
}
