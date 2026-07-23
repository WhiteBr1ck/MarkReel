import assert from "node:assert/strict";
import test from "node:test";
import { placeAnchoredMenu } from "./context-menu-position.ts";

test("places an anchored menu below when enough space remains", () => {
  assert.deepEqual(
    placeAnchoredMenu({
      anchor: { left: 200, right: 240, top: 100, bottom: 132 },
      viewportWidth: 800,
      viewportHeight: 600,
      menuWidth: 200,
      menuHeight: 152
    }),
    { x: 40, y: 140, placement: "below" }
  );
});

test("places an anchored menu above near the bottom edge", () => {
  assert.deepEqual(
    placeAnchoredMenu({
      anchor: { left: 200, right: 240, top: 520, bottom: 552 },
      viewportWidth: 800,
      viewportHeight: 600,
      menuWidth: 200,
      menuHeight: 152
    }),
    { x: 40, y: 360, placement: "above" }
  );
});

test("keeps an oversized anchored menu inside the viewport", () => {
  assert.deepEqual(
    placeAnchoredMenu({
      anchor: { left: 4, right: 36, top: 180, bottom: 212 },
      viewportWidth: 220,
      viewportHeight: 240,
      menuWidth: 200,
      menuHeight: 260
    }),
    { x: 12, y: 12, placement: "viewport" }
  );
});
