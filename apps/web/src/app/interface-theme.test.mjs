import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));
const postcss = nextRequire("postcss");
const ts = require("typescript");
const css = postcss.parse(await readFile(new URL("./globals.css", import.meta.url), "utf8"));
const selector = (rule) => rule.selector.replace(/\s+/g, " ").trim();
function rules(name) { return css.nodes.filter((node) => node.type === "rule" && selector(node) === name); }
function declarations(name) {
  return Object.fromEntries(rules(name).flatMap((rule) => rule.nodes.filter((node) => node.type === "decl").map((node) => [node.prop, node.value])));
}
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("interface text and primary button tokens meet AA contrast in both themes", () => {
  const base = declarations(":root");
  for (const [name, tokens] of [["dark", base], ["light", { ...base, ...declarations('html[data-theme="light"]') }]]) {
    for (const text of ["--text", "--muted", "--muted2"]) {
      for (const surface of ["--bg", "--surface-1", "--surface-2"]) {
        assert.ok(contrast(tokens[text], tokens[surface]) >= 4.5, `${name}: ${text} on ${surface}`);
      }
    }
    assert.ok(contrast(tokens["--accent-contrast"], tokens["--accent-strong"]) >= 4.5);
  }
  for (const accent of ["blue", "green", "violet", "amber"]) {
    const tokens = { ...base, ...declarations(`html[data-accent="${accent}"]`) };
    assert.ok(contrast(tokens["--accent-contrast"], tokens["--accent-strong"]) >= 4.5, accent);
  }
});

test("player uses shared theme tokens and keeps video and markup geometry independent", () => {
  for (const name of [".mr-player-page", 'html[data-theme="light"] .mr-player-page']) {
    assert.ok(!("--text" in declarations(name)), "player must not shadow theme text tokens");
  }
  assert.equal(declarations(".mr-player-page__video-surface").position, "relative");
  assert.equal(declarations(".mr-player-page__video")["object-fit"], "contain");
  assert.equal(declarations(".mr-player-page__video").height, "100%");
  assert.equal(declarations(".mr-player-page__markup-toolbar").position, "relative");
  assert.equal(declarations(".mr-player-page__main")["grid-template-rows"], "auto minmax(0, 1fr) auto");
  assert.equal(declarations(".mr-player-page__icon-btn").color, "var(--text)");
  assert.equal(declarations(".mr-player-page__controls .mr-player-page__icon-btn").color, "#fff");
});

test("workbench sections stay unframed and typography has no tracking overrides", () => {
  assert.equal(declarations(".mr-page__card").background, "transparent");
  assert.equal(declarations(".mr-page__hero")["box-shadow"], "none");
  assert.equal(declarations(".mr-toolbar-group").border, "0");
  css.walkDecls("letter-spacing", (decl) => assert.equal(decl.value, "0"));
});

test("light appearance preserves the original warm brand surfaces", () => {
  const tokens = declarations('html[data-theme="light"]');
  assert.equal(tokens["--bg"], "#f5f4ed");
  assert.equal(tokens["--surface-1"], "#faf9f5");
  assert.equal(tokens["--nav-bg"], "#f0eee6");
});

test("branded loading sweep is animated with compact corners", () => {
  const placeholders = declarations(".mr-workbench-loading__side span, .mr-workbench-loading__main span");
  assert.equal(placeholders.animation, "mr-loading-sweep 1.4s ease-in-out infinite");
  assert.ok(placeholders.background.startsWith("linear-gradient("));
  assert.equal(declarations(".mr-workbench-loading__card").width, "min(620px, 100%)");
  assert.equal(declarations(".mr-workbench-loading__card")["border-radius"], "8px");
  assert.ok(css.nodes.some((node) => node.type === "atrule" && node.name === "media" && node.params.includes("prefers-reduced-motion")), "reduced motion remains available");
});

test("version titles wrap inside the inspector and timecodes have a complete color border", () => {
  assert.equal(declarations(".mr-media-versions__select")["white-space"], "normal");
  assert.equal(declarations(".mr-media-versions__select")["min-width"], "0");
  assert.equal(declarations(".mr-media-versions__title")["overflow-wrap"], "anywhere");
  const timecode = declarations(".mr-player-page__annotation-timecode");
  assert.equal(timecode.border, "1px solid var(--annotation-color, var(--accent))");
  assert.equal(timecode["box-shadow"], "none");
  assert.ok(!("border-left" in timecode));
});

test("create-project hint opens below its anchor and navigation/player buttons keep visible outlines", () => {
  const tooltip = declarations(".mr-tooltip--below-end::after");
  assert.equal(tooltip.top, "calc(100% + 8px)");
  assert.equal(tooltip.bottom, "auto");
  assert.equal(tooltip["inset-inline-end"], "0");
  assert.equal(declarations(".mr-shell__nav-group .mr-shell__nav-button")["border-color"], "var(--btn-border)");
  assert.equal(declarations(".mr-player-page__controls .mr-player-page__icon-btn")["border-color"], "rgba(255, 255, 255, 0.3)");
});

test("server path browsing has a full path row and a taller separately scrolling file list", () => {
  assert.equal(declarations(".mr-dialog--wide").width, "min(1040px, calc(100vw - 48px))");
  assert.equal(declarations(".mr-server-import__pathbar")["grid-template-columns"], "minmax(0, 1fr) auto");
  assert.equal(declarations(".mr-server-import__path")["overflow-wrap"], "anywhere");
  assert.equal(declarations(".mr-server-import__files").height, "clamp(200px, 34dvh, 360px)");
  assert.equal(declarations(".mr-server-import__files").overflow, "auto");
});

test("workbench removes repeated view/upload hints and widens only server uploads", async () => {
  const text = await readFile(new URL("./app/page.client.tsx", import.meta.url), "utf8");
  const source = ts.createSourceFile("page.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const elements = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) elements.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const attribute = (node, name) => node.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(source) === name)?.initializer;
  const createButton = elements.find((node) => attribute(node, "aria-label")?.getText(source) === '"新建项目"');
  assert.ok(attribute(createButton, "className").text.split(" ").includes("mr-tooltip--below-end"));
  const uploadDialog = elements.find((node) => node.tagName.getText(source) === "Dialog" && attribute(node, "open")?.getText(source) === "{!!uploadDraft}");
  assert.equal(attribute(uploadDialog, "description"), undefined);
  const size = attribute(uploadDialog, "size").expression;
  assert.ok(ts.isConditionalExpression(size));
  assert.equal(size.condition.getText(source), 'uploadDraft?.source === "server"');
  assert.equal(size.whenTrue.text, "wide");
  assert.equal(size.whenFalse.text, "default");
  assert.ok(!elements.some((node) => attribute(node, "className")?.text === "mr-workspace-view-meta"));
  for (const removed of ["选择本地文件或服务器挂载路径，再确认处理参数和目标目录。", "暂未选择文件", "请选择一个服务器挂载目录内的视频文件", "原始上传会保留原始文件，分辨率与帧率选项不会生效。"]) {
    assert.ok(!text.includes(removed), removed);
  }
});

test("account settings initializes saved theme on a direct page load", async () => {
  const source = ts.createSourceFile("page.tsx", await readFile(new URL("./app/user-settings/page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializesTheme = false;
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useTheme") initializesTheme = true;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(initializesTheme);
});
