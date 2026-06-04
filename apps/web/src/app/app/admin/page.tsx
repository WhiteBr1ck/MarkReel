"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Dialog } from "../_components/dialog";
import { api } from "../_components/api";

type AdminUser = {
  id: string;
  username: string;
  displayName: string | null;
  globalRole: "admin" | "user";
  lastLoginAt: string | null;
  disabledAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type MeResponse = {
  user: {
    id: string;
    username: string;
    displayName: string | null;
    globalRole?: "admin" | "user";
  } | null;
};

type UsersResponse = { users: AdminUser[] };
type UserResponse = { user: AdminUser };

function sanitizeWorkbenchHref(value: string | null): string {
  if (!value) return "/app";
  try {
    const url = new URL(value, "http://localhost");
    if (url.pathname !== "/app") return "/app";
    return `${url.pathname}${url.search}${url.hash}` || "/app";
  } catch {
    return "/app";
  }
}

function toZhError(e: any) {
  const code = e?.data?.error as string | undefined;
  const map: Record<string, string> = {
    unauthorized: "登录已失效，请重新登录。",
    username_taken: "这个用户名已被占用。",
    cannot_delete_self: "不能删除当前管理员账号。",
    cannot_disable_self: "不能停用当前管理员账号。",
    cannot_demote_self: "不能把当前管理员降级为普通用户。",
    not_found: "目标用户不存在。",
    use_user_settings: "当前管理员自己的密码请到“用户设置”里修改。"
  };
  if (e?.status === 403) return "只有管理员可以访问这里。";
  return map[code ?? ""] ?? "请求失败，请稍后重试。";
}

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function sortUsers(users: AdminUser[]) {
  return [...users].sort((a, b) => a.username.localeCompare(b.username, "zh-CN"));
}

function userStatusLabel(user: AdminUser) {
  if (user.deletedAt) return "已删除";
  if (user.disabledAt) return "已停用";
  return "正常";
}

export default function AdminPage() {
  const [backHref, setBackHref] = useState("/app");
  const [viewer, setViewer] = useState<MeResponse["user"]>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "disabled" | "deleted" | "all">("active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editingDisplayName, setEditingDisplayName] = useState("");
  const [editingGlobalRole, setEditingGlobalRole] = useState<AdminUser["globalRole"]>("user");
  const [resettingUser, setResettingUser] = useState<AdminUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
  const [deletingUser, setDeletingUser] = useState<AdminUser | null>(null);

  useEffect(() => {
    setBackHref(sanitizeWorkbenchHref(localStorage.getItem("mr_last_workbench_url")));
  }, []);

  async function load() {
    const me = await api<MeResponse>("/me");
    setViewer(me.user);
    if (me.user?.globalRole !== "admin") {
      throw Object.assign(new Error("forbidden"), { status: 403 });
    }
    const result = await api<UsersResponse>("/admin/users");
    setUsers(result.users);
  }

  useEffect(() => {
    void load().catch((e) => setError(toZhError(e)));
  }, []);

  const sortedUsers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return sortUsers(users).filter((user) => {
      const matchesQuery = !keyword || user.username.includes(keyword) || user.displayName?.toLowerCase().includes(keyword);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && !user.deletedAt && !user.disabledAt) ||
        (statusFilter === "disabled" && !user.deletedAt && Boolean(user.disabledAt)) ||
        (statusFilter === "deleted" && Boolean(user.deletedAt));
      return matchesQuery && matchesStatus;
    });
  }, [query, statusFilter, users]);

  function replaceUser(next: AdminUser) {
    setUsers((prev) => sortUsers(prev.map((user) => (user.id === next.id ? next : user))));
  }

  async function createUser() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<UserResponse>("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
          displayName: displayName.trim() || undefined
        })
      });
      setUsers((prev) => sortUsers([...prev, result.user]));
      setUsername("");
      setPassword("");
      setDisplayName("");
      setMessage("账号已创建。");
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveEditedUser() {
    if (!editingUser) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<UserResponse>(`/admin/users/${editingUser.id}/profile`, {
        method: "PATCH",
        body: JSON.stringify({
          displayName: editingDisplayName.trim() || null,
          globalRole: editingGlobalRole
        })
      });
      replaceUser(result.user);
      setEditingUser(null);
      setEditingDisplayName("");
      setEditingGlobalRole("user");
      setMessage("账号资料已更新。");
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitResetPassword() {
    if (!resettingUser) return;
    if (resetPassword.length < 8) {
      setError("新密码至少需要 8 位。");
      return;
    }
    if (resetPassword !== resetPasswordConfirm) {
      setError("两次输入的新密码不一致。");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api(`/admin/users/${resettingUser.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ newPassword: resetPassword })
      });
      setResettingUser(null);
      setResetPassword("");
      setResetPasswordConfirm("");
      setMessage("密码已重置，目标账号的旧会话会失效。");
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser() {
    if (!deletingUser) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api(`/admin/users/${deletingUser.id}`, { method: "DELETE" });
      setUsers((prev) => prev.filter((user) => user.id !== deletingUser.id));
      setDeletingUser(null);
      setMessage("账号已删除。");
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  async function setUserDisabled(user: AdminUser, disabled: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<UserResponse>(`/admin/users/${user.id}/${disabled ? "disable" : "enable"}`, { method: "POST", body: "{}" });
      replaceUser(result.user);
      setMessage(disabled ? "账号已停用。" : "账号已启用。");
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  async function restoreUser(user: AdminUser) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<UserResponse>(`/admin/users/${user.id}/restore`, { method: "POST", body: "{}" });
      replaceUser(result.user);
      setMessage("账号已恢复。");
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mr-page">
      <div className="mr-page__shell">
        <section className="mr-panel mr-page__hero">
          <div className="mr-page__hero-head">
            <div>
              <div className="mr-page__eyebrow">Admin</div>
              <h1 className="mr-page__title">管理员设置</h1>
            </div>
            <Link href={backHref} prefetch={false} className="mr-btn mr-page__link">
              返回工作台
            </Link>
          </div>
        </section>

        {error ? <div className="mr-feedback mr-feedback--error">{error}</div> : null}
        {message ? <div className="mr-feedback mr-feedback--success">{message}</div> : null}

        {viewer?.globalRole === "admin" ? (
          <div className="mr-page__admin-grid">
            <section className="mr-panel mr-page__card">
              <div className="mr-page__section-kicker">Create</div>
              <h2 className="mr-page__section-title">新增账号</h2>

              <div className="mr-page__stack">
                <label className="mr-field">
                  <span className="mr-field__label">用户名</span>
                  <input className="mr-input" value={username} onChange={(event) => setUsername(event.target.value)} />
                </label>
                <label className="mr-field">
                  <span className="mr-field__label">昵称</span>
                  <input className="mr-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                </label>
                <label className="mr-field">
                  <span className="mr-field__label">初始密码</span>
                  <input className="mr-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
                </label>
                <div className="mr-page__actions">
                  <button className="mr-btn mr-btn--primary" type="button" disabled={busy || username.trim().length < 3 || password.length < 8} onClick={() => void createUser()}>
                    创建账号
                  </button>
                </div>
              </div>
            </section>

            <section className="mr-panel mr-page__card mr-page__admin-users-card">
              <div className="mr-page__section-kicker">Users</div>
              <h2 className="mr-page__section-title">账号列表</h2>
              <p className="mr-page__note">管理员不能删除自己；自己的密码也请到“用户设置”中修改。</p>

              <div className="mr-page__actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <input className="mr-input" value={query} placeholder="搜索用户名或昵称" onChange={(event) => setQuery(event.target.value)} />
                <select className="mr-input" style={{ maxWidth: 150 }} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
                  <option value="active">正常账号</option>
                  <option value="disabled">已停用</option>
                  <option value="deleted">已删除</option>
                  <option value="all">全部</option>
                </select>
              </div>

              <div className="mr-page__admin-user-list">
                {sortedUsers.map((user) => {
                  const isSelf = viewer?.id === user.id;
                  const isDeleted = Boolean(user.deletedAt);
                  const isDisabled = Boolean(user.disabledAt);
                  return (
                    <div key={user.id} className="mr-page__user-row">
                      <div>
                        <strong>{user.displayName || user.username}</strong>
                        <div className="mr-page__user-meta">
                          <span>@{user.username}</span>
                          <span>{user.globalRole === "admin" ? "管理员" : "普通用户"}</span>
                          <span>{userStatusLabel(user)}</span>
                          <span>创建于 {formatDate(user.createdAt)}</span>
                          <span>最近更新 {formatDate(user.updatedAt)}</span>
                          <span>最近登录 {user.lastLoginAt ? formatDate(user.lastLoginAt) : "从未"}</span>
                        </div>
                      </div>
                      <div className="mr-page__actions">
                        <button
                          className="mr-btn"
                          type="button"
                          disabled={busy || isDeleted}
                          onClick={() => {
                            setEditingUser(user);
                            setEditingDisplayName(user.displayName ?? "");
                            setEditingGlobalRole(user.globalRole);
                          }}
                        >
                          编辑
                        </button>
                        <button
                          className="mr-btn"
                          type="button"
                          disabled={busy || isSelf || isDeleted}
                          onClick={() => {
                            setResettingUser(user);
                            setResetPassword("");
                            setResetPasswordConfirm("");
                          }}
                        >
                          重置密码
                        </button>
                        {isDeleted ? (
                          <button className="mr-btn" type="button" disabled={busy} onClick={() => void restoreUser(user)}>
                            恢复
                          </button>
                        ) : (
                          <button className="mr-btn" type="button" disabled={busy || isSelf} onClick={() => void setUserDisabled(user, !isDisabled)}>
                            {isDisabled ? "启用" : "停用"}
                          </button>
                        )}
                        {!isDeleted ? (
                          <button
                            className="mr-btn mr-btn--danger"
                            type="button"
                            disabled={busy || isSelf}
                            onClick={() => setDeletingUser(user)}
                          >
                            删除
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {sortedUsers.length === 0 ? <div className="mr-page__note">没有匹配的账号。</div> : null}
              </div>
            </section>
          </div>
        ) : null}
      </div>

      <Dialog
        open={Boolean(editingUser)}
        title="编辑账号资料"
        description={editingUser ? `调整 @${editingUser.username} 的显示昵称和全局身份。` : undefined}
        onClose={() => {
          if (busy) return;
          setEditingUser(null);
          setEditingDisplayName("");
          setEditingGlobalRole("user");
        }}
        footer={
          <>
            <button
              type="button"
              className="mr-btn mr-btn--ghost"
              disabled={busy}
              onClick={() => {
                setEditingUser(null);
                setEditingDisplayName("");
                setEditingGlobalRole("user");
              }}
            >
              取消
            </button>
            <button type="button" className="mr-btn mr-btn--primary" disabled={busy} onClick={() => void saveEditedUser()}>
              {busy ? "保存中…" : "保存修改"}
            </button>
          </>
        }
      >
        <div className="mr-dialog__stack">
          <label className="mr-field">
            <span className="mr-field__label">昵称</span>
            <input autoFocus className="mr-input" value={editingDisplayName} placeholder="留空则显示用户名" onChange={(event) => setEditingDisplayName(event.target.value)} />
          </label>
          <label className="mr-field">
            <span className="mr-field__label">身份</span>
            <select className="mr-input" value={editingGlobalRole} onChange={(event) => setEditingGlobalRole(event.target.value as AdminUser["globalRole"])}>
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
          </label>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(resettingUser)}
        title="重置账号密码"
        description={resettingUser ? `将为 @${resettingUser.username} 直接设置新密码，并让该账号旧会话失效。` : undefined}
        onClose={() => {
          if (busy) return;
          setResettingUser(null);
          setResetPassword("");
          setResetPasswordConfirm("");
        }}
        footer={
          <>
            <button
              type="button"
              className="mr-btn mr-btn--ghost"
              disabled={busy}
              onClick={() => {
                setResettingUser(null);
                setResetPassword("");
                setResetPasswordConfirm("");
              }}
            >
              取消
            </button>
            <button
              type="button"
              className="mr-btn mr-btn--primary"
              disabled={busy || resetPassword.length < 8 || resetPassword !== resetPasswordConfirm}
              onClick={() => void submitResetPassword()}
            >
              {busy ? "提交中…" : "确认重置"}
            </button>
          </>
        }
      >
        <div className="mr-dialog__stack">
          <label className="mr-field">
            <span className="mr-field__label">新密码</span>
            <input autoFocus className="mr-input" type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} />
          </label>
          <label className="mr-field">
            <span className="mr-field__label">确认新密码</span>
            <input className="mr-input" type="password" value={resetPasswordConfirm} onChange={(event) => setResetPasswordConfirm(event.target.value)} />
          </label>
          <div className="mr-dialog__note">这里不会回显旧密码。保存后，目标账号需要用新密码重新登录。</div>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(deletingUser)}
        title="删除账号"
        description={deletingUser ? `你将软删除 @${deletingUser.username}，该账号现有会话会立即失效。` : undefined}
        onClose={() => {
          if (busy) return;
          setDeletingUser(null);
        }}
        footer={
          <>
            <button type="button" className="mr-btn mr-btn--ghost" disabled={busy} onClick={() => setDeletingUser(null)}>
              取消
            </button>
            <button type="button" className="mr-btn mr-btn--danger" disabled={busy} onClick={() => void deleteUser()}>
              {busy ? "处理中…" : "确认删除"}
            </button>
          </>
        }
      >
        <div className="mr-dialog__note mr-dialog__note--danger">这是账号层面的停用操作。删除后，该用户将无法继续使用当前账号登录。</div>
      </Dialog>
    </main>
  );
}
