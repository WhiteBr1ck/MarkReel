import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, jsxFactory: "element" };
const transpile = (source) => ts.transpileModule(source, { compilerOptions }).outputText;
const sorting = runInNewContext(`${transpile(readFileSync(new URL("./server-import-sort.ts", import.meta.url), "utf8"))}\nexports;`, { exports: {} });
const { DEFAULT_SERVER_IMPORT_SORT, nextServerImportSort, serverImportFileType, serverImportModifiedTime, serverImportSizeBytes, sortServerImportEntries } = sorting;
const file = (name, values = {}) => ({ name, path: name, kind: "file", sizeBytes: 10, updatedAt: 100, ...values });
const folder = (name, values = {}) => file(name, { kind: "directory", sizeBytes: undefined, ...values });
const names = (entries, sort) => Array.from(sortServerImportEntries(entries, sort), (entry) => entry.name);
const keys = ["name", "type", "size", "updatedAt"];

test("default name ascending is natural, case-insensitive, directories first, and non-mutating", () => {
  const entries = Object.freeze([
    file("take10.mp4"), folder("Folder10"), file("TAKE2.mp4"), folder("folder2"), file("take1.mp4")
  ].map(Object.freeze));
  assert.deepEqual({ ...DEFAULT_SERVER_IMPORT_SORT }, { key: "name", direction: "asc" });
  assert.deepEqual(names(entries), ["folder2", "Folder10", "take1.mp4", "TAKE2.mp4", "take10.mp4"]);
  assert.deepEqual(names(entries, { key: "name", direction: "desc" }), ["Folder10", "folder2", "take10.mp4", "TAKE2.mp4", "take1.mp4"]);
  const sorted = sortServerImportEntries(entries);
  assert.notEqual(sorted, entries);
  assert.equal(sorted[0], entries[3], "preserve entry identity and paths for selection");
  assert.deepEqual(entries.map((entry) => entry.name), ["take10.mp4", "Folder10", "TAKE2.mp4", "folder2", "take1.mp4"]);
  assert.deepEqual(names([file("片段10.mp4"), file("片段2.mp4"), file("片段1.mp4")]), ["片段1.mp4", "片段2.mp4", "片段10.mp4"]);
});

for (const key of keys) {
  for (const direction of ["asc", "desc"]) {
    test(`${key} ${direction} keeps directories first`, () => {
      const sorted = sortServerImportEntries([file("a.mp4", { sizeBytes: 0, updatedAt: 0 }), folder("z.mov", { updatedAt: 900 }), file("z.mp4"), folder("a", { updatedAt: 1 })], { key, direction });
      assert.deepEqual(Array.from(sorted, (entry) => entry.kind), ["directory", "directory", "file", "file"]);
    });
  }
}

test("type sorting uses the final extension, case-insensitively, with natural name ties", () => {
  const entries = [file("take10.MP4"), file("last.MOV"), file("take2.mp4"), file("no-extension"), file("draft.cut.avi")];
  assert.equal(serverImportFileType(folder("folder.mp4")), "");
  for (const name of ["no-extension", ".hidden", "trailing."]) assert.equal(serverImportFileType(file(name)), "");
  assert.equal(serverImportFileType(file("draft.cut.MP4")), "mp4");
  assert.deepEqual(names(entries, { key: "type", direction: "asc" }), ["no-extension", "draft.cut.avi", "last.MOV", "take2.mp4", "take10.MP4"]);
  assert.deepEqual(names(entries, { key: "type", direction: "desc" }), ["take10.MP4", "take2.mp4", "last.MOV", "draft.cut.avi", "no-extension"]);
});

test("size sorting compares bytes, includes zero, and resolves ties by natural name", () => {
  const entries = [file("take10.mp4", { sizeBytes: 1024 }), file("zero.mp4", { sizeBytes: 0 }), file("large.mp4", { sizeBytes: 10000 }), file("take2.mp4", { sizeBytes: 1024 }), file("small.mp4", { sizeBytes: 9 })];
  assert.deepEqual(names(entries, { key: "size", direction: "asc" }), ["zero.mp4", "small.mp4", "take2.mp4", "take10.mp4", "large.mp4"]);
  assert.deepEqual(names(entries, { key: "size", direction: "desc" }), ["large.mp4", "take10.mp4", "take2.mp4", "small.mp4", "zero.mp4"]);
});

test("modified sorting compares timestamps rather than display labels and resolves ties naturally", () => {
  const entries = [file("take10.mp4", { updatedAt: 1000 }), file("old.mp4", { updatedAt: 0 }), file("new.mp4", { updatedAt: 10000 }), file("take2.mp4", { updatedAt: 1000 })];
  assert.deepEqual(names(entries, { key: "updatedAt", direction: "asc" }), ["old.mp4", "take2.mp4", "take10.mp4", "new.mp4"]);
  assert.deepEqual(names(entries, { key: "updatedAt", direction: "desc" }), ["new.mp4", "take10.mp4", "take2.mp4", "old.mp4"]);
});

for (const [key, property, normalize, invalid] of [
  ["size", "sizeBytes", serverImportSizeBytes, [undefined, NaN, Infinity, -Infinity, -1]],
  ["updatedAt", "updatedAt", serverImportModifiedTime, [undefined, NaN, Infinity, -Infinity, 8.64e15 + 1]]
]) {
  test(`${key}: unknown/invalid values stay last in either direction`, () => {
    const unknown = invalid.map((value, index) => file(`unknown${index}.mp4`, { [property]: value }));
    unknown.forEach((entry) => assert.equal(normalize(entry), undefined));
    assert.equal(normalize(file("zero.mp4", { [property]: 0 })), 0);
    const entries = [unknown[2], file("small.mp4", { [property]: 0 }), ...unknown.filter((_, i) => i !== 2), file("large.mp4", { [property]: 200 })];
    assert.deepEqual(names(entries, { key, direction: "asc" }), ["small.mp4", "large.mp4", ...unknown.map((entry) => entry.name)]);
    assert.deepEqual(names(entries, { key, direction: "desc" }), ["large.mp4", "small.mp4", ...unknown.map((entry) => entry.name).reverse()]);
  });
}

test("empty input and equal natural names are stable; toggling does not mutate state", () => {
  assert.deepEqual(names([]), []);
  const entries = [file("take02.mp4"), file("TAKE2.mp4"), file("take2.mp4")];
  for (const key of keys) {
    assert.deepEqual(names(entries, { key, direction: "asc" }), entries.map((entry) => entry.name));
    assert.deepEqual(names(entries, { key, direction: "desc" }), entries.map((entry) => entry.name));
    const current = Object.freeze({ key, direction: "asc" });
    assert.deepEqual({ ...nextServerImportSort(current, key) }, { key, direction: "desc" });
    assert.deepEqual({ ...nextServerImportSort(nextServerImportSort(current, key), key) }, { key, direction: "asc" });
    assert.deepEqual({ ...nextServerImportSort({ key: "name", direction: "desc" }, key) }, { key, direction: "asc" });
  }
});

// Exercise the real page's local handlers and JSX at their React/transport boundary.
const pageSource = ts.createSourceFile("page.client.tsx", readFileSync(new URL("../page.client.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findNode(root, predicate) {
  if (predicate(root)) return root;
  return ts.forEachChild(root, (child) => findNode(child, predicate));
}
const app = pageSource.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "AppClient");
const openUpload = app.body.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "openUploadDialog");
const table = findNode(app, (node) => ts.isJsxElement(node) && node.openingElement.tagName.getText(pageSource) === "table");
assert.ok(openUpload && table, "the actual upload handler and server browser table must exist");

for (const sourceMediaId of [undefined, "media-1"]) {
  test(`${sourceMediaId ? "new version" : "new media"}: opening defaults to original and resets browser sorting`, () => {
    let draft;
    let sort;
    const open = runInNewContext(`${transpile(openUpload.getText(pageSource))}\nopenUploadDialog;`, {
      effectivePid: "project-1", rootFid: "root", effectiveFid: "folder", workspaceScopeKey: "scope",
      workspace: { items: [{ id: "media-1", name: "Existing video" }] }, versionTarget: null,
      DEFAULT_SERVER_IMPORT_SORT,
      setUploadDraft(value) { draft = value; },
      setServerImportSort(value) { sort = value; },
      setServerImportPath() {}, setServerImportEntries() {}, setServerImportParentPath() {}, setServerImportError() {}
    });
    open(sourceMediaId);
    assert.equal(draft.mode, "original");
    assert.equal(draft.sourceMediaId, sourceMediaId);
    assert.equal(draft.folderId, "folder");
    assert.equal(draft.title, sourceMediaId ? "Existing video" : "");
    assert.deepEqual({ ...sort }, { key: "name", direction: "asc" });
  });
}

test("upload mode selector falls back to original while retaining explicit compression", () => {
  const menu = findNode(app, (node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(pageSource) === "UploadMenu" && node.attributes.properties.some((attr) => ts.isJsxAttribute(attr) && attr.name.text === "value" && attr.initializer?.getText(pageSource).includes("uploadDraft?.mode")));
  assert.ok(menu, "upload mode selector must exist");
  const expression = (name) => menu.attributes.properties.find((attr) => attr.name?.text === name).initializer.expression.getText(pageSource);
  const evaluate = (name, uploadDraft) => runInNewContext(transpile(`(${expression(name)})`), { uploadDraft });
  assert.equal(evaluate("value", null), "original");
  assert.equal(evaluate("value", {}), "original");
  assert.equal(evaluate("value", { mode: "compress" }), "compress");
  assert.equal(evaluate("options", null)[0].value, "original", "invalid selection fallback also uses original");
});

const renderTableCode = transpile(`function renderServerTable() { return (${table.getText(pageSource)}); }`);
function browserTable(entries) {
  const selected = [];
  const browsed = [];
  const context = {
    ...sorting,
    serverImportSort: DEFAULT_SERVER_IMPORT_SORT, serverImportBusy: false, uploadDraft: { serverPath: "take10.mp4" },
    element(type, props, ...children) { return { type, props: props ?? {}, children: children.flat(Infinity).filter((child) => child != null && child !== false) }; },
    IconUp: "icon-up", IconSort: "icon-sort", IconFolder: "icon-folder", IconVideo: "icon-video",
    formatBytes: (bytes) => `${bytes} B`,
    setServerImportSort(update) { context.serverImportSort = update(context.serverImportSort); },
    browseServerImport(path) { browsed.push(path); }, selectServerImportFile(entry) { selected.push(entry); }
  };
  const render = runInNewContext(`${renderTableCode}\nrenderServerTable;`, context);
  return { context, selected, browsed, render() { context.sortedServerImportEntries = sortServerImportEntries(entries, context.serverImportSort); return render(); } };
}
function allNodes(tree, type) {
  return [tree, ...tree.children.flatMap((child) => typeof child === "object" ? allNodes(child, type) : [])].filter((node) => node.type === type);
}

test("real column buttons expose one aria-sort, toggle each column, and preserve selection paths", () => {
  const entries = [file("take10.mp4"), file("take2.mp4"), folder("folder")];
  const browser = browserTable(entries);
  for (const [index, key] of keys.entries()) {
    let headers = allNodes(browser.render(), "th");
    assert.equal(headers.length, 4);
    headers.forEach((header) => assert.equal(header.props.scope, "col"));
    assert.equal(headers.filter((header) => header.props["aria-sort"]).length, 1);
    const button = allNodes(headers[index], "button")[0];
    assert.equal(button.props.type, "button");
    assert.match(button.props["aria-label"], /排序$/);
    button.props.onClick();
    const expected = index === 0 ? "descending" : "ascending";
    headers = allNodes(browser.render(), "th");
    assert.equal(headers[index].props["aria-sort"], expected);
    assert.equal(browser.context.serverImportSort.key, key);
    allNodes(headers[index], "button")[0].props.onClick();
    assert.equal(allNodes(browser.render(), "th")[index].props["aria-sort"], expected === "ascending" ? "descending" : "ascending");
  }
  const buttons = allNodes(browser.render(), "button");
  const selected = buttons.find((button) => button.props["aria-label"] === "选择文件 take10.mp4");
  assert.equal(selected.props["aria-pressed"], true);
  const label = allNodes(selected, "span")[0];
  assert.equal(label.props.style.minWidth, 0);
  assert.equal(label.props.style.textOverflow, "ellipsis");
  let stopped = false;
  selected.props.onClick({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(browser.selected[0], entries[0]);
  buttons.find((button) => button.props["aria-label"] === "打开文件夹 folder").props.onClick({ stopPropagation() {} });
  assert.deepEqual(browser.browsed, ["folder"]);
});

test("browser renders invalid metadata as unknown, zero bytes correctly, and loading/empty status", () => {
  const browser = browserTable([file("invalid.mp4", { updatedAt: 8.64e15 + 1, sizeBytes: Infinity }), file("zero.mp4", { sizeBytes: 0 })]);
  const cells = allNodes(browser.render(), "td");
  assert.equal(cells.filter((cell) => cell.children.includes("未知")).length, 2);
  assert.ok(cells.some((cell) => cell.children.includes("0 B")));
  const empty = browserTable([]);
  assert.equal(allNodes(empty.render(), "span").find((span) => span.props.role === "status").children[0], "没有可显示的文件。");
  empty.context.serverImportBusy = true;
  assert.equal(allNodes(empty.render(), "span").find((span) => span.props.role === "status").children[0], "正在读取目录…");
});
