import assert from "node:assert/strict";
import test from "node:test";
import { ANNOTATION_COLORS, annotationProgress, filterAnnotations } from "./annotation-model.ts";
import { emptyHistory, reduceHistory } from "./history-stack.ts";
import { playerShortcut, isSubmitKey } from "./player-shortcuts.ts";
import { playerVersionHref } from "./player-navigation.ts";

const key = (value, modifiers = {}) => ({ key: value, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, isComposing: false, keyCode: 0, defaultPrevented: false, ...modifiers });

test("completion progress excludes replies and does not depend on the visible filter", () => {
  const annotations = [
    { id: "root1", completedAt: "done", replies: [{ id: "reply1", completedAt: "done" }] },
    { id: "root2", completedAt: null },
    { id: "reply2", parentId: "root2", completedAt: "done" }
  ];
  assert.deepEqual(annotationProgress(annotations), { completed: 1, total: 2 });
  assert.deepEqual(filterAnnotations(annotations, "completed").map((row) => row.id), ["root1"]);
  assert.deepEqual(filterAnnotations(annotations, "incomplete").map((row) => row.id), ["root2"]);
  assert.deepEqual(annotationProgress(annotations), { completed: 1, total: 2 });
  assert.deepEqual(annotationProgress([]), { completed: 0, total: 0 });
});

test("a single vivid palette is used for new annotations without remapping persisted colors", () => {
  assert.equal(new Set(ANNOTATION_COLORS).size, 6);
  assert.ok(ANNOTATION_COLORS.every((value) => /^#[0-9a-f]{6}$/.test(value)));
  const saved = { color: "#c96442" };
  filterAnnotations([{ ...saved, parentId: null }], "all");
  assert.equal(saved.color, "#c96442");
});

test("frame stepping and history work with Ctrl and Meta; native shortcuts remain untouched", () => {
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
    assert.equal(playerShortcut(key("ArrowLeft", modifier), false), "previousFrame");
    assert.equal(playerShortcut(key("ArrowRight", modifier), false), "nextFrame");
    assert.equal(playerShortcut(key("z", modifier), false), "undo");
    assert.equal(playerShortcut(key("Z", { ...modifier, shiftKey: true }), false), "redo");
    assert.equal(playerShortcut(key("y", modifier), false), "redo");
    assert.equal(playerShortcut(key("f", modifier), false), null);
    assert.equal(playerShortcut(key("z", modifier), true), null);
    assert.equal(playerShortcut(key("ArrowLeft", modifier), true), null);
  }
  for (const [value, action] of [[" ", "play"], ["ArrowLeft", "back"], ["ArrowRight", "forward"], ["F", "fullscreen"], ["a", "annotate"], ["m", "mute"]]) {
    assert.equal(playerShortcut(key(value), false), action);
  }
});

test("IME, handled events, and editable focus do not trigger playback or submission", () => {
  for (const state of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }, { altKey: true }]) {
    assert.equal(playerShortcut(key("ArrowRight", { ctrlKey: true, ...state }), false), null);
    assert.equal(isSubmitKey(key("Enter", { ctrlKey: true, ...state })), false);
  }
  assert.equal(isSubmitKey(key("Enter", { ctrlKey: true })), true);
  assert.equal(isSubmitKey(key("Enter", { metaKey: true })), true);
  assert.equal(isSubmitKey(key("Enter")), false);
});

test("drawing has an independent undo/redo stack and a new operation discards redo", () => {
  let drawing = emptyHistory();
  drawing = reduceHistory(drawing, { type: "append", value: "stroke1" });
  drawing = reduceHistory(drawing, { type: "append", value: "text1" });
  drawing = reduceHistory(drawing, { type: "undo" });
  assert.deepEqual(drawing.present, ["stroke1"]);
  drawing = reduceHistory(drawing, { type: "redo" });
  assert.deepEqual(drawing.present, ["stroke1", "text1"]);
  drawing = reduceHistory(drawing, { type: "undo" });
  drawing = reduceHistory(drawing, { type: "append", value: "stroke2" });
  assert.deepEqual(drawing.future, []);
  drawing = reduceHistory(drawing, { type: "clear" });
  assert.deepEqual(drawing.present, []);
  drawing = reduceHistory(drawing, { type: "undo" });
  assert.deepEqual(drawing.present, ["stroke1", "stroke2"]);
  assert.deepEqual(reduceHistory(drawing, { type: "reset" }), emptyHistory());
});

test("switching versions preserves the project and all unrelated query parameters", () => {
  const url = new URL(playerVersionHref("mid=old&pid=project&folder=folder1&sort=name", "new/media"), "http://localhost");
  assert.equal(url.searchParams.get("mid"), "new/media");
  assert.equal(url.searchParams.get("pid"), "project");
  assert.equal(url.searchParams.get("folder"), "folder1");
  assert.equal(url.searchParams.get("sort"), "name");
});
