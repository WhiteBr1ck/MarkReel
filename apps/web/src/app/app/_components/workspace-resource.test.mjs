import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceResource, workspaceKey } from "./workspace-resource.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

for (const dimension of ["user", "project", "folder"]) {
  for (const outcome of ["success", "error"]) {
    test(`ignores delayed ${outcome} and finally after ${dimension} changes`, async () => {
      const resource = createWorkspaceResource();
      const parts = ["user-A", "project-A", "folder-A"];
      const keyA = workspaceKey(...parts);
      resource.activate(keyA);
      const old = deferred();
      let oldSignal;
      const oldRequest = resource.refresh(keyA, (signal) => { oldSignal = signal; return old.promise; });
      await tick();
      parts[["user", "project", "folder"].indexOf(dimension)] += "-B";
      const keyB = workspaceKey(...parts);
      resource.activate(keyB);
      assert.equal(oldSignal.aborted, true);
      const current = deferred();
      const currentRequest = resource.refresh(keyB, () => current.promise);
      await tick();
      const expected = resource.getSnapshot();
      if (outcome === "error") old.reject(new Error("late forbidden"));
      else old.resolve({ privateData: "A" });
      assert.equal(await oldRequest, null);
      assert.equal(resource.getSnapshot(), expected);
      assert.equal(resource.getSnapshot().loading, true);
      current.resolve({ privateData: "B" });
      assert.deepEqual(await currentRequest, { privateData: "B" });
      assert.equal(resource.getSnapshot().loading, false);
      assert.equal(resource.getSnapshot().error, null);
    });
  }
}

test("manual refresh supersedes the in-flight request in the same folder", async () => {
  const resource = createWorkspaceResource();
  resource.activate("A");
  const old = deferred();
  const latest = deferred();
  const first = resource.refresh("A", () => old.promise);
  await tick();
  const second = resource.refresh("A", () => latest.promise);
  await tick();
  latest.resolve("fresh");
  await second;
  old.reject(new Error("late error"));
  await first;
  assert.deepEqual(resource.getSnapshot(), { key: "A", data: "fresh", error: null, loading: false });
});

test("workspace and trash have independent data, errors, and loading lifecycles", async () => {
  const workspace = createWorkspaceResource();
  const trash = createWorkspaceResource();
  workspace.activate("folder-A");
  trash.activate("project-A");
  const delayedTrash = deferred();
  const trashRequest = trash.refresh("project-A", () => delayedTrash.promise);
  await workspace.refresh("folder-A", async () => "folder-A");
  workspace.activate("folder-B");
  await workspace.refresh("folder-B", async () => "folder-B");
  delayedTrash.reject(new Error("trash unavailable"));
  await trashRequest;
  assert.equal(workspace.getSnapshot().data, "folder-B");
  assert.equal(workspace.getSnapshot().error, null);
  assert.equal(trash.getSnapshot().error.message, "trash unavailable");
  assert.equal(trash.getSnapshot().loading, false);
});

for (const reason of ["logout", "unmount"]) {
  test(`${reason} invalidates success, error, finally, and retained refresh callbacks`, async () => {
    const resource = createWorkspaceResource();
    resource.activate("private-user");
    const delayed = deferred();
    const pending = resource.refresh("private-user", () => delayed.promise);
    await tick();
    resource.clear();
    const empty = resource.getSnapshot();
    delayed.resolve("private data");
    assert.equal(await pending, null);
    assert.equal(resource.getSnapshot(), empty);
    let requests = 0;
    assert.equal(await resource.refresh("private-user", async () => { requests += 1; }), null);
    assert.equal(requests, 0);
  });
}

test("A to B to A still rejects the original A response", async () => {
  const resource = createWorkspaceResource();
  resource.activate("A");
  const old = deferred();
  const first = resource.refresh("A", () => old.promise);
  await tick();
  resource.activate("B");
  resource.activate("A");
  await resource.refresh("A", async () => "new A");
  old.resolve("old A");
  await first;
  assert.equal(resource.getSnapshot().data, "new A");
});

test("ordinary loads deduplicate in-flight work and reuse only the active scope", async () => {
  const resource = createWorkspaceResource();
  resource.activate("A");
  const delayed = deferred();
  let calls = 0;
  const load = () => { calls += 1; return delayed.promise; };
  const first = resource.refresh("A", load, false);
  const second = resource.refresh("A", load, false);
  assert.equal(first, second);
  delayed.resolve("A");
  await first;
  await resource.refresh("A", load, false);
  assert.equal(calls, 1);
  resource.activate("B");
  resource.activate("A");
  assert.equal(resource.getSnapshot().data, null);
});

test("current errors are visible and retry clears them", async () => {
  const resource = createWorkspaceResource();
  resource.activate("A");
  await resource.refresh("A", () => { throw new Error("forbidden"); });
  assert.equal(resource.getSnapshot().error.message, "forbidden");
  assert.equal(resource.getSnapshot().loading, false);
  assert.equal(await resource.refresh("A", async () => "retried"), "retried");
  assert.equal(resource.getSnapshot().error, null);
});

test("scope keys distinguish nullable and delimiter-containing identifiers", () => {
  assert.equal(workspaceKey("user", null), null);
  assert.notEqual(workspaceKey("a:b", "c"), workspaceKey("a", "b:c"));
});
