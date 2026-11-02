import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Exercise the actual page handlers without a browser/server or a duplicate
// implementation of their guards. Only their React state/transport boundary is mocked.
const source = ts.createSourceFile("page.client.tsx", readFileSync(new URL("../page.client.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "AppClient");
assert.ok(app?.body, "AppClient must exist");
const names = ["refreshMe", "onAuth", "onLogout"];
const handlers = names.map((name) => {
  const node = app.body.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(node, `${name} must exist`);
  return node.getText(source);
}).join("\n");
const lifecycle = app.body.statements.find((node) => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "useLayoutEffect");
assert.ok(lifecycle, "The authentication mount/unmount effect must exist");
const executable = ts.transpileModule(`${handlers}\nconst mountAuthEffect = ${lifecycle.expression.arguments[0].getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const userA = { id: "user-A", username: "alice", displayName: null };
const userB = { id: "user-B", username: "bob", displayName: null };

function session(username = "bob") {
  const pending = new Map();
  const requests = [];
  const events = [];
  const state = { user: userA, checking: true, error: "previous error", resets: 0 };
  const authSequence = { current: 0 };
  const mounted = { current: false };
  const context = {
    authSequence,
    mounted,
    username,
    password: "valid-password",
    displayName: "",
    mode: "login",
    uploadAborters: { current: new Map() },
    api(path) {
      requests.push(path);
      const next = pending.get(path)?.shift();
      assert.ok(next, `Unexpected API request: ${path}`);
      return next.promise;
    },
    setUser(user) { state.user = user; events.push(["user", user?.id ?? null]); },
    setErr(error) { state.error = error; events.push(["error", error]); },
    setAuthChecking(checking) { state.checking = checking; events.push(["checking", checking]); },
    clearWorkspaceData() { events.push(["clear-workspace"]); },
    resetAuthenticatedState() {
      state.user = null;
      state.checking = false;
      state.resets += 1;
      events.push(["reset"]);
    },
    toZhError(error) { return error.message; }
  };
  const actions = runInNewContext(`${executable}\nconst unmountAuth = mountAuthEffect();\n({ refreshMe, onAuth, onLogout, unmount: unmountAuth, remount: mountAuthEffect })`, context);
  return {
    ...actions, state, events, requests,
    enqueue(path) {
      const request = deferred();
      pending.set(path, [...pending.get(path) ?? [], request]);
      return request;
    }
  };
}

for (const outcome of ["success", "error"]) {
  test(`old /me ${outcome} after logout cannot restore user or finish the current auth check`, async () => {
    const s = session();
    const oldMe = s.enqueue("/me");
    const refresh = s.refreshMe();
    const logoutReply = s.enqueue("/auth/logout");
    const logout = s.onLogout();
    const events = [...s.events];
    if (outcome === "success") oldMe.resolve({ user: userA });
    else oldMe.reject(new Error("expired /me failed"));
    await refresh;
    assert.equal(s.state.user, null);
    assert.equal(s.state.checking, true);
    assert.deepEqual(s.events, events, "stale success, catch and finally must have no state effects");
    logoutReply.resolve({ ok: true });
    await logout;
    assert.equal(s.state.checking, false);
  });

  test(`old /me ${outcome} during a new login cannot publish the old user`, async () => {
    const s = session();
    const oldMe = s.enqueue("/me");
    const refresh = s.refreshMe();
    const loginReply = s.enqueue("/auth/login");
    const newMe = s.enqueue("/me");
    const login = s.onAuth();
    const events = [...s.events];
    if (outcome === "success") oldMe.resolve({ user: userA });
    else oldMe.reject(new Error("old credentials expired"));
    await refresh;
    assert.deepEqual(s.events, events);
    assert.equal(s.state.resets, 0);
    loginReply.resolve({ ok: true });
    await tick();
    newMe.resolve({ user: userB });
    await login;
    assert.equal(s.state.user.id, userB.id);
    assert.deepEqual(s.events.filter(([kind]) => kind === "user"), [["user", userB.id]]);
  });

  test(`old /me ${outcome} after user B logs in cannot reactivate user A's scope`, async () => {
    const s = session();
    const oldMe = s.enqueue("/me");
    const refresh = s.refreshMe();
    const loginReply = s.enqueue("/auth/login");
    const newMe = s.enqueue("/me");
    const login = s.onAuth();
    loginReply.resolve({ ok: true });
    await tick();
    newMe.resolve({ user: userB });
    await login;
    const events = [...s.events];
    if (outcome === "success") oldMe.resolve({ user: userA });
    else oldMe.reject(new Error("old credentials expired"));
    await refresh;
    assert.equal(s.state.user.id, userB.id);
    assert.deepEqual(s.events, events);
    assert.equal(s.state.resets, 0);
  });

  test(`unmount invalidates old /me ${outcome}, including finally`, async () => {
    const s = session();
    const oldMe = s.enqueue("/me");
    const refresh = s.refreshMe();
    s.unmount();
    if (outcome === "success") oldMe.resolve({ user: userA });
    else oldMe.reject(new Error("network failure"));
    await refresh;
    assert.deepEqual(s.events, []);
  });
}

test("same-session overlapping /me reads only accept the latest response", async () => {
  const s = session();
  const firstReply = s.enqueue("/me");
  const first = s.refreshMe();
  const secondReply = s.enqueue("/me");
  const second = s.refreshMe();
  secondReply.resolve({ user: userB });
  await second;
  const events = [...s.events];
  firstReply.resolve({ user: userA });
  await first;
  assert.equal(s.state.user.id, userB.id);
  assert.deepEqual(s.events, events);
});

test("a delayed old login cannot start /me after logout", async () => {
  const s = session();
  const loginReply = s.enqueue("/auth/login");
  const login = s.onAuth();
  const logoutReply = s.enqueue("/auth/logout");
  const logout = s.onLogout();
  logoutReply.resolve({ ok: true });
  await logout;
  const events = [...s.events];
  loginReply.resolve({ ok: true });
  await login;
  assert.equal(s.state.user, null);
  assert.deepEqual(s.requests, ["/auth/login", "/auth/logout"]);
  assert.deepEqual(s.events, events);
});

test("a delayed logout finally cannot overwrite a newer login's pending check", async () => {
  const s = session();
  const logoutReply = s.enqueue("/auth/logout");
  const logout = s.onLogout();
  const loginReply = s.enqueue("/auth/login");
  const newMe = s.enqueue("/me");
  const login = s.onAuth();
  const events = [...s.events];
  logoutReply.resolve({ ok: true });
  await logout;
  assert.equal(s.state.checking, true);
  assert.deepEqual(s.events, events);
  loginReply.resolve({ ok: true });
  await tick();
  newMe.resolve({ user: userB });
  await login;
  assert.equal(s.state.user.id, userB.id);
  assert.equal(s.state.checking, false);
});

test("a current /me failure still resets authenticated state and finishes checking", async () => {
  const s = session();
  const reply = s.enqueue("/me");
  const refresh = s.refreshMe();
  reply.reject(new Error("unauthorized"));
  await refresh;
  assert.equal(s.state.user, null);
  assert.equal(s.state.resets, 1);
  assert.equal(s.state.checking, false);
});

test("logout and re-login with the same user ID still reject the old session's /me", async () => {
  const s = session("alice");
  const oldMe = s.enqueue("/me");
  const refresh = s.refreshMe();
  const logoutReply = s.enqueue("/auth/logout");
  const logout = s.onLogout();
  logoutReply.resolve({ ok: true });
  await logout;
  const loginReply = s.enqueue("/auth/login");
  const newMe = s.enqueue("/me");
  const login = s.onAuth();
  loginReply.resolve({ ok: true });
  await tick();
  const renewedUser = { ...userA, globalRole: "user", displayName: "new session" };
  newMe.resolve({ user: renewedUser });
  await login;
  const events = [...s.events];
  oldMe.resolve({ user: { ...userA, globalRole: "admin", displayName: "old session" } });
  await refresh;
  assert.equal(s.state.user, renewedUser);
  assert.deepEqual(s.events, events);
});

test("unmount and remount invalidate the original /me even before the next refresh", async () => {
  const s = session();
  const oldMe = s.enqueue("/me");
  const refresh = s.refreshMe();
  s.unmount();
  const cleanup = s.remount();
  oldMe.resolve({ user: userA });
  await refresh;
  assert.deepEqual(s.events, []);
  cleanup();
});
