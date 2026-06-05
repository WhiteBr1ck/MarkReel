"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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

type Organization = {
  id: string;
  name: string;
  owner: { id: string; username: string; displayName: string | null; avatarPreset?: string | null } | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type OrganizationsResponse = { organizations: Organization[] };
type OrganizationResponse = { organization: Organization };

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
    user_not_found: "目标用户不存在。",
    organization_has_projects: "该组织下还有项目，不能删除。",
    owner_required: "请先指定负责人。",
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

function sortOrganizations(organizations: Organization[]) {
  return [...organizations].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function userStatusLabel(user: AdminUser) {
  if (user.deletedAt) return "已删除";
  if (user.disabledAt) return "已停用";
  return "正常";
}

export default function AdminPage() {
  const router = useRouter();
  const [backHref, setBackHref] = useState("/app");
  const [viewer, setViewer] = useState<MeResponse["user"]>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [organizationQuery, setOrganizationQuery] = useState("");
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
  const [editingOrganization, setEditingOrganization] = useState<Organization | null>(null);
  const [editingOrganizationName, setEditingOrganizationName] = useState("");
  const [ownerOrganization, setOwnerOrganization] = useState<Organization | null>(null);
  const [ownerUsername, setOwnerUsername] = useState("");
  const [deletingOrganization, setDeletingOrganization] = useState<Organization | null>(null);

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
    const organizationResult = await api<OrganizationsResponse>("/organizations");
    setOrganizations(sortOrganizations(organizationResult.organizations));
  }

  useEffect(() => {
    void load().catch((e) => {
      if (e?.status === 401) {
        router.replace("/app");
        return;
      }
      setError(toZhError(e));
    });
  }, [router]);

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

  const sortedOrganizations = useMemo(() => {
    const keyword = organizationQuery.trim().toLowerCase();
    return sortOrganizations(organizations).filter((organization) => {
      if (!keyword) return true;
      return organization.name.toLowerCase().includes(keyword) || organization.owner?.username.toLowerCase().includes(keyword) || organization.owner?.displayName?.toLowerCase().includes(keyword);
    });
  }, [organizationQuery, organizations]);

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

  async function createOrganization() {
    const name = organizationName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<OrganizationResponse>("/admin/organizations", {
        method: "POST",
        body: JSON.stringify({ name })
      });
      setOrganizations((prev) => sortOrganizations([...prev, result.organization]));
      setOrganizationName("");
      setMessage("组织已创建。");
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveOrganizationName() {
    if (!editingOrganization) return;
    const name = editingOrganizationName.trim();
    if (!name || name === editingOrganization.name) {
      setEditingOrganization(null);
      setEditingOrganizationName("");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<OrganizationResponse>(`/admin/organizations/${editingOrganization.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name })
      });
      setOrganizations((prev) => sortOrganizations(prev.map((item) => (item.id === result.organization.id ? result.organization : item))));
      setEditingOrganization(null);
      setEditingOrganizationName("");
      setMessage("组织已重命名。");
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveOrganizationOwner() {
    if (!ownerOrganization) return;
    const usernameValue = ownerUsername.trim();
    if (!usernameValue) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<OrganizationResponse>(`/admin/organizations/${ownerOrganization.id}/owner`, {
        method: "POST",
        body: JSON.stringify({ username: usernameValue })
      });
      setOrganizations((prev) => sortOrganizations(prev.map((item) => (item.id === result.organization.id ? result.organization : item))));
      setOwnerOrganization(null);
      setOwnerUsername("");
      setMessage("组织负责人已更新。");
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteOrganization() {
    if (!deletingOrganization) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api<{ ok: true }>(`/admin/organizations/${deletingOrganization.id}`, { method: "DELETE" });
      setOrganizations((prev) => prev.filter((item) => item.id !== deletingOrganization.id));
      setDeletingOrganization(null);
      setMessage("组织已删除。");
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mr-page">
      <div className="mr-page__shell mr-page__shell--admin">
        <section className="mr-panel mr-page__hero">
          <div className="mr-page__hero-head">
            <div>
              <div className="mr-page__eyebrow">Admin</div>
              <h1 className="mr-page__title">管理员设置</h1>
            </div>
            <div className="mr-page__actions">
              <Link href="/app/organizations" prefetch={false} className="mr-btn mr-page__link">
                我的组织设置
              </Link>
              <Link href={backHref} prefetch={false} className="mr-btn mr-page__link">
                返回工作台
              </Link>
            </div>
          </div>
        </section>

        {error ? <div className="mr-feedback mr-feedback--error">{error}</div> : null}
        {message ? <div className="mr-feedback mr-feedback--success">{message}</div> : null}

        {viewer?.globalRole === "admin" ? (
          <div className="mr-page__admin-grid">
            <section className="mr-panel mr-page__card mr-page__admin-create-card">
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

              <div className="mr-page__admin-user-list mr-page__admin-user-list--accounts">
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

            <section className="mr-panel mr-page__card mr-page__admin-span-card">
              <div className="mr-page__section-kicker">Organizations</div>
              <h2 className="mr-page__section-title">组织管理</h2>
              <p className="mr-page__note">这里管理所有组织本身：创建组织、重命名、删除，以及指定组织负责人。</p>

              <div className="mr-page__actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div className="mr-page__actions" style={{ alignItems: "center" }}>
                  <input className="mr-input" value={organizationName} placeholder="新组织名称" onChange={(event) => setOrganizationName(event.target.value)} />
                  <button className="mr-btn mr-btn--primary" type="button" disabled={busy || !organizationName.trim()} onClick={() => void createOrganization()}>
                    创建组织
                  </button>
                </div>
                <input className="mr-input" style={{ maxWidth: 260 }} value={organizationQuery} placeholder="搜索组织或负责人" onChange={(event) => setOrganizationQuery(event.target.value)} />
              </div>

              <div className="mr-page__admin-user-list mr-page__admin-user-list--loose">
                {sortedOrganizations.map((organization) => (
                  <div key={organization.id} className="mr-page__user-row">
                    <div>
                      <strong>{organization.name}</strong>
                      <div className="mr-page__user-meta">
                        <span>负责人 {organization.owner ? `${organization.owner.displayName || organization.owner.username} (@${organization.owner.username})` : "未设置"}</span>
                        <span>创建于 {formatDate(organization.createdAt)}</span>
                        <span>最近更新 {formatDate(organization.updatedAt)}</span>
                      </div>
                    </div>
                    <div className="mr-page__actions">
                      <button
                        className="mr-btn"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setEditingOrganization(organization);
                          setEditingOrganizationName(organization.name);
                        }}
                      >
                        重命名
                      </button>
                      <button
                        className="mr-btn"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setOwnerOrganization(organization);
                          setOwnerUsername(organization.owner?.username ?? "");
                        }}
                      >
                        设置负责人
                      </button>
                      <button className="mr-btn mr-btn--danger" type="button" disabled={busy} onClick={() => setDeletingOrganization(organization)}>
                        删除
                      </button>
                    </div>
                  </div>
                ))}
                {sortedOrganizations.length === 0 ? <div className="mr-page__note">没有匹配的组织。</div> : null}
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

      <Dialog
        open={Boolean(editingOrganization)}
        title="重命名组织"
        description={editingOrganization ? `修改“${editingOrganization.name}”的组织名称。` : undefined}
        onClose={() => {
          if (busy) return;
          setEditingOrganization(null);
          setEditingOrganizationName("");
        }}
        footer={
          <>
            <button type="button" className="mr-btn mr-btn--ghost" disabled={busy} onClick={() => setEditingOrganization(null)}>
              取消
            </button>
            <button type="button" className="mr-btn mr-btn--primary" disabled={busy || !editingOrganizationName.trim()} onClick={() => void saveOrganizationName()}>
              {busy ? "保存中…" : "保存名称"}
            </button>
          </>
        }
      >
        <div className="mr-dialog__stack">
          <label className="mr-field">
            <span className="mr-field__label">组织名称</span>
            <input autoFocus className="mr-input" value={editingOrganizationName} onChange={(event) => setEditingOrganizationName(event.target.value)} />
          </label>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(ownerOrganization)}
        title="设置组织负责人"
        description={ownerOrganization ? `指定“${ownerOrganization.name}”的负责人。` : undefined}
        onClose={() => {
          if (busy) return;
          setOwnerOrganization(null);
          setOwnerUsername("");
        }}
        footer={
          <>
            <button type="button" className="mr-btn mr-btn--ghost" disabled={busy} onClick={() => setOwnerOrganization(null)}>
              取消
            </button>
            <button type="button" className="mr-btn mr-btn--primary" disabled={busy || !ownerUsername.trim()} onClick={() => void saveOrganizationOwner()}>
              {busy ? "保存中…" : "保存负责人"}
            </button>
          </>
        }
      >
        <div className="mr-dialog__stack">
          <label className="mr-field">
            <span className="mr-field__label">负责人用户名</span>
            <input autoFocus className="mr-input" value={ownerUsername} placeholder="输入现有用户名" onChange={(event) => setOwnerUsername(event.target.value)} />
          </label>
          <div className="mr-dialog__note">保存后，原负责人会降为组织管理员，新负责人会自动加入该组织。</div>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(deletingOrganization)}
        title="删除组织"
        description={deletingOrganization ? `你将删除“${deletingOrganization.name}”。` : undefined}
        onClose={() => {
          if (busy) return;
          setDeletingOrganization(null);
        }}
        footer={
          <>
            <button type="button" className="mr-btn mr-btn--ghost" disabled={busy} onClick={() => setDeletingOrganization(null)}>
              取消
            </button>
            <button type="button" className="mr-btn mr-btn--danger" disabled={busy} onClick={() => void deleteOrganization()}>
              {busy ? "处理中…" : "确认删除"}
            </button>
          </>
        }
      >
        <div className="mr-dialog__note mr-dialog__note--danger">如果组织下还有项目，系统会拒绝删除。</div>
      </Dialog>
    </main>
  );
}
