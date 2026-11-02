import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Run against the web dev server. This checks the real workbench with delayed
// API fixtures, not backend throughput or original-media decoding performance.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.MARKREEL_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.MARKREEL_WEB_URL || "http://localhost:5090";
const browser = await chromium.launch({ headless: true, ...(process.env.MARKREEL_BROWSER_EXECUTABLE ? { executablePath: process.env.MARKREEL_BROWSER_EXECUTABLE } : {}) });
const user = { id: "fixture-user", username: "fixture-user", displayName: "Workspace QA" };
const projects = Array.from({ length: 60 }, (_, i) => ({ id: `p${i + 1}`, name: `项目 ${i + 1}`, ownerId: user.id, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", capabilities: ["project:edit_assets", "project:delete"] }));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture(count, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const calls = [];
  const bodies = [];
  let logout = false;
  const held = new Map();
  const media = Array.from({ length: count }, (_, i) => ({ id: `media-${i}`, kind: "video", name: `素材_${String(i).padStart(4, "0")}.mov`, updatedAt: 1_700_000_000_000 + i, sizeBytes: 30_000_000_000, durationSeconds: 600, frameCount: 14400, width: 3840, height: 2160, bitrateKbps: 400000 }));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice(4);
    calls.push(`${path}${url.search}`);
    if (route.request().method() === "POST") {
      try { bodies.push({ path, body: route.request().postDataJSON() }); } catch {}
    }
    let data;
    let status = 200;
    if (path === "/me") {
      data = logout ? { error: "unauthorized" } : { user };
      status = logout ? 401 : 200;
    } else if (path === "/auth/logout") { logout = true; data = { ok: true }; }
    else if (path === "/projects") data = { projects };
    else if (path === "/projects/p1/media" && route.request().method() === "POST") data = { media: { id: "new-local-version" } };
    else if (path === "/projects/p1/media/import/server") data = { media: { id: "new-server-version" }, queued: false };
    else if (path === "/server-import/browse") data = { path: "", parentPath: null, rootEnabled: true, entries: [{ name: "new-version.mov", path: "new-version.mov", kind: "file", sizeBytes: 10, updatedAt: 1700000000000 }] };
    else if (path.endsWith("/versions")) data = { seriesId: "series-1", canUploadVersion: true, canDeleteSeries: true, versions: [{ id: "media-0", projectId: "p1", title: "素材 V1", versionIndex: 1, status: "ready", reviewStatus: "pending", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", creator: user, available: true, canManage: true }] };
    else if (path.endsWith("/upload/presign")) data = { upload: { url: `${base}/api/fixture-upload`, objectKey: "fixture.mov", mode: "original" } };
    else if (path === "/fixture-upload" || path.endsWith("/process")) data = { ok: true };
    else if (path.endsWith("/processing-status")) data = { media: { id: "new-version", status: "ready", updatedAt: "2026-01-01T00:00:00Z" }, processing: null };
    else if (path.endsWith("/preview")) data = { preview: { url: `${base}/fixture.mp4`, fileName: "fixture.mov", inline: true } };
    else if (path.endsWith("/workspace")) {
      const projectId = path.split("/")[2];
      const folderId = url.searchParams.get("folderId");
      const rule = held.get(folderId);
      if (rule) {
        rule.started?.();
        await rule.promise;
        if (rule.error) { status = 403; data = { error: "forbidden" }; }
      }
      data ??= {
        project: projects.find((project) => project.id === projectId),
        activeFolderId: folderId,
        breadcrumbs: [{ id: folderId, name: folderId }],
        folderTree: { id: `root-${projectId}`, name: "根目录", children: [] },
        items: folderId.startsWith("root-") ? media : [{ ...media[0], id: folderId, name: folderId }]
      };
    } else if (path.endsWith("/trash")) data = { items: [{ ...media[0], id: "trash-item", name: "回收站素材", deletedAt: 1_700_000_000_000 }] };
    else if (path.endsWith("/thumbnail")) { status = 404; data = { error: "not_found" }; }
    else { status = 404; data = { error: "not_found" }; }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) }).catch(() => {});
  });
  const navigate = (folder, scope = "") => page.evaluate(({ folder, scope }) => history.pushState(null, "", `/app?pid=p1&fid=${folder}&view=list${scope ? `&scope=${scope}` : ""}`), { folder, scope });
  function hold(folder, error = false) {
    let release;
    let started;
    const ready = new Promise((resolve) => { started = resolve; });
    const promise = new Promise((resolve) => { release = resolve; });
    held.set(folder, { promise, error, started });
    return { release, ready };
  }
  return { page, context, errors, calls, bodies, navigate, hold };
}

try {
  // Warm Next compilation separately from the reported post-response timings.
  const warm = await fixture(1, { width: 1440, height: 900 });
  await warm.page.goto(`${base}/app?pid=p1&fid=root-p1&view=list`);
  await warm.page.locator("[data-workspace-item]").first().waitFor();
  await warm.context.close();

  for (const count of [100, 1000]) {
    const f = await fixture(count, { width: 1440, height: 900 });
    await f.page.addInitScript(() => {
      window.__workspaceResponseAt = 0;
      window.__longTasks = [];
      new PerformanceObserver((list) => window.__longTasks.push(...list.getEntries().map((entry) => entry.duration))).observe({ type: "longtask", buffered: true });
      const original = window.fetch;
      window.fetch = async (...args) => {
        const result = await original(...args);
        if (String(args[0]).includes("/workspace")) window.__workspaceResponseAt = performance.now();
        return result;
      };
    });
    await f.page.goto(`${base}/app?pid=p1&fid=root-p1&view=list`);
    await f.page.locator("[data-workspace-item]").nth(99).waitFor();
    const render = await f.page.evaluate(() => ({ responseToRowsMs: +(performance.now() - window.__workspaceResponseAt).toFixed(1), rows: document.querySelectorAll("[data-workspace-item]").length, domNodes: document.querySelectorAll("*").length, longTasksMs: window.__longTasks }));
    assert.equal(render.rows, 100);
    assert.equal(f.calls.filter((path) => path.includes("/trash")).length, 0);
    assert.equal(f.calls.filter((path) => path.includes("/thumbnail")).length, 0);
    const top = await f.page.locator(".mr-shell__topbar").boundingBox();
    await f.page.locator(".mr-shell__center").evaluate((element) => { element.scrollTop = 1200; });
    const topAfter = await f.page.locator(".mr-shell__topbar").boundingBox();
    assert.equal(top.y, topAfter.y);
    const scroll = await f.page.evaluate(() => ({ body: document.scrollingElement.scrollTop, center: document.querySelector(".mr-shell__center").scrollTop, sidebar: document.querySelector(".mr-project-list-scroll").scrollHeight > document.querySelector(".mr-project-list-scroll").clientHeight }));
    assert.equal(scroll.body, 0);
    assert.ok(scroll.center > 0);
    assert.ok(scroll.sidebar);
    await f.page.locator(".mr-shell__center").evaluate((element) => { element.scrollTop = 0; });
    let pageChangeMs = null;
    if (count === 1000) {
      const start = performance.now();
      await f.page.getByRole("button", { name: "下一页", exact: true }).click();
      await f.page.locator('[data-workspace-item="media-899"]').waitFor();
      pageChangeMs = +(performance.now() - start).toFixed(1);
      assert.equal(await f.page.locator("[data-workspace-item]").count(), 100);
    }
    const readsBeforeSearch = f.calls.length;
    const searchStart = performance.now();
    await f.page.getByRole("textbox", { name: "搜索", exact: true }).fill("0099");
    const inputMs = +(performance.now() - searchStart).toFixed(1);
    await f.page.waitForFunction(() => new URLSearchParams(location.search).get("q") === "0099");
    assert.equal(await f.page.getByRole("textbox", { name: "搜索", exact: true }).inputValue(), "0099");
    await f.page.waitForFunction(() => document.querySelectorAll("[data-workspace-item]").length === 1);
    assert.equal(f.calls.length, readsBeforeSearch);
    await f.page.getByRole("textbox", { name: "搜索", exact: true }).fill("");
    await f.page.waitForFunction(() => document.querySelectorAll("[data-workspace-item]").length === 100);
    console.log(JSON.stringify({ check: "performance", count, ...render, pageChangeMs, inputMs, scroll }));
    await f.page.screenshot({ path: `.tmp/workspace-${count}-desktop.png` });

    const old = f.hold("slow-A", true);
    await f.navigate("slow-A");
    await old.ready;
    const latest = f.hold("latest-B");
    await f.navigate("latest-B");
    await latest.ready;
    old.release();
    await pause(80);
    assert.ok(await f.page.getByRole("status").filter({ hasText: "正在加载素材" }).count());
    assert.equal(await f.page.locator('.mr-shell--workspace [role="alert"]').count(), 0);
    latest.release();
    await f.page.locator('[data-workspace-item="latest-B"]').waitFor();
    assert.equal(f.calls.filter((path) => path.includes("/trash")).length, 0);
    await f.navigate("latest-B", "trash");
    await f.page.locator('[data-workspace-item="trash-item"]').waitFor();
    const workspaceReads = f.calls.filter((path) => path.includes("/workspace")).length;
    await f.navigate("latest-B");
    await f.page.locator('[data-workspace-item="latest-B"]').waitFor();
    assert.equal(f.calls.filter((path) => path.includes("/workspace")).length, workspaceReads);
    assert.equal(f.calls.filter((path) => path.includes("/trash")).length, 1);
    const pending = f.hold("logout-pending");
    await f.navigate("logout-pending");
    await pending.ready;
    await f.page.locator(".mr-shell__user-button").click();
    await f.page.getByRole("button", { name: /退出/ }).click();
    pending.release();
    await f.page.locator(".mr-auth").waitFor();
    assert.equal(await f.page.locator("[data-workspace-item]").count(), 0);
    assert.deepEqual(f.errors, []);
    console.log(JSON.stringify({ check: "lifecycle", count, result: "passed", requests: f.calls.filter((path) => path.includes("/workspace") || path.includes("/trash")) }));
    await f.context.close();
  }

  const versions = await fixture(1, { width: 1440, height: 900 });
  await versions.page.goto(`${base}/app?pid=p1&fid=root-p1&view=list`);
  await versions.page.locator('[data-workspace-item="media-0"]').waitFor();
  await versions.page.getByRole("button", { name: "条目菜单：素材_0000.mov", exact: true }).click();
  await versions.page.getByRole("button", { name: "版本历史", exact: true }).click();
  await versions.page.getByRole("heading", { name: "版本历史", exact: true }).waitFor();
  await versions.page.getByRole("button", { name: "上传新版本", exact: true }).click();
  const dialog = versions.page.getByRole("dialog");
  await dialog.getByRole("heading", { name: "上传新版本" }).waitFor();
  assert.equal(await dialog.locator('input[type="file"]').getAttribute("multiple"), null);
  await dialog.locator('input[type="file"]').setInputFiles({ name: "version.mov", mimeType: "video/quicktime", buffer: Buffer.from("fixture") });
  await dialog.getByRole("button", { name: "开始上传", exact: true }).click();
  await versions.page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await pause(500);
  assert.equal(versions.bodies.find((entry) => entry.path === "/projects/p1/media").body.sourceMediaId, "media-0");
  assert.equal(await versions.page.locator("[data-workspace-item]").count(), 1);
  await versions.page.getByRole("button", { name: "上传新版本", exact: true }).click();
  await dialog.getByRole("button", { name: "服务器路径", exact: true }).click();
  await dialog.getByRole("button", { name: /new-version.mov/ }).click();
  await dialog.getByRole("button", { name: "开始导入", exact: true }).click();
  await pause(500);
  assert.equal(versions.bodies.find((entry) => entry.path === "/projects/p1/media/import/server").body.sourceMediaId, "media-0");
  assert.ok(versions.calls.filter((path) => path.includes("/workspace")).length > 1);
  assert.equal(await versions.page.locator("[data-workspace-item]").count(), 1);
  assert.deepEqual(versions.errors, []);
  console.log(JSON.stringify({ check: "version-upload-contracts", result: "passed", posts: versions.bodies.filter((entry) => entry.path === "/projects/p1/media" || entry.path === "/projects/p1/media/import/server") }));
  await versions.page.evaluate(() => history.pushState(null, "", "/app?pid=p1&fid=root-p1&view=list&select=1&sel=media-0&panel=1"));
  await versions.page.locator(".mr-workspace-versions ol li button").first().click();
  await versions.page.waitForURL((url) => url.pathname === "/app/player" && url.searchParams.get("mid") === "media-0");
  console.log(JSON.stringify({ check: "version-selection", result: "passed", path: new URL(versions.page.url()).pathname, mediaId: new URL(versions.page.url()).searchParams.get("mid") }));
  await versions.context.close();

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }, { width: 1080, height: 900 }]) {
    const f = await fixture(1000, viewport);
    await f.page.goto(`${base}/app?pid=p1&fid=root-p1&view=grid`);
    await f.page.locator("[data-workspace-item]").nth(99).waitFor();
    const layout = await f.page.evaluate(() => ({ viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, bodyScrollable: document.scrollingElement.scrollHeight > innerHeight, centerOverflow: getComputedStyle(document.querySelector(".mr-shell__center")).overflowY, sidebarOverflow: getComputedStyle(document.querySelector(".mr-shell__sidebar")).overflowY }));
    assert.ok(layout.pageWidth <= viewport.width, JSON.stringify(layout));
    assert.equal(layout.bodyScrollable, true);
    assert.notEqual(layout.centerOverflow, "hidden");
    assert.notEqual(layout.sidebarOverflow, "hidden");
    await f.page.locator("[data-workspace-item]").last().scrollIntoViewIfNeeded();
    const last = await f.page.locator("[data-workspace-item]").last().boundingBox();
    assert.ok(last.y + last.height <= viewport.height + 1, JSON.stringify(last));
    await f.page.evaluate(() => scrollTo(0, 0));
    await f.page.screenshot({ path: `.tmp/workspace-${viewport.width}-mobile.png` });
    assert.deepEqual(f.errors, []);
    console.log(JSON.stringify({ check: "responsive", ...viewport, ...layout }));
    await f.context.close();
  }
} finally {
  await browser.close();
}
