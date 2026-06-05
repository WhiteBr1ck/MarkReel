"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "../_components/dialog";
import { api } from "../_components/api";
import { IconChevron, IconSearch } from "../_components/icons";

type MeResponse = {
  user: {
    id: string;
    username: string;
    displayName: string | null;
    globalRole?: "admin" | "user";
  } | null;
};

type Organization = {
  id: string;
  name: string;
  owner: { id: string; username: string; displayName: string | null; avatarPreset?: string | null } | null;
  myRole: OrganizationRole;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type OrganizationRole = "owner" | "admin" | "member";
type OrganizationMember = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarPreset?: string | null;
  role: OrganizationRole;
  createdAt: string;
};

type OrganizationsResponse = { organizations: Organization[] };
type OrganizationResponse = { organization: Organization };
type OrganizationMembersResponse = { members: OrganizationMember[] };
type OrganizationMemberResponse = { member: OrganizationMember };
type UserSearchResult = { id: string; username: string; displayName: string | null; avatarPreset?: string | null };
type UserSearchResponse = { users: UserSearchResult[] };

type MenuOption<T extends string> = { value: T; label: string; meta?: string };

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
    user_not_found: "目标用户不存在。",
    member_not_found: "组织成员不存在。",
    last_owner_required: "组织至少需要保留一位负责人。",
    not_found: "目标组织不存在。"
  };
  if (e?.status === 403) return "只有组织负责人或组织管理员可以修改这里。";
  return map[code ?? ""] ?? "请求失败，请稍后重试。";
}

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function roleLabel(role: OrganizationRole) {
  const labels: Record<OrganizationRole, string> = {
    owner: "负责人",
    admin: "管理员",
    member: "成员"
  };
  return labels[role];
}

function canManageOrganization(organization: Organization | null) {
  return organization?.myRole === "owner" || organization?.myRole === "admin";
}

function MenuSelect<T extends string>({
  value,
  options,
  disabled,
  onChange,
  placeholder = "请选择"
}: {
  value: T | "";
  options: Array<MenuOption<T>>;
  disabled?: boolean;
  onChange: (value: T) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    function closeMenu() {
      setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="mr-select-menu" onClick={(event) => event.stopPropagation()}>
      <button
        className="mr-btn mr-btn--menu mr-select-menu__trigger"
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="mr-select-menu__value">{selected?.label ?? placeholder}</span>
        <IconChevron size={16} dir="down" />
      </button>
      {open ? (
        <div className="mr-panel mr-select-menu__popover">
          <div className="mr-select-menu__list" role="listbox">
            {options.map((option) => (
              <button
                key={option.value}
                className={`mr-btn mr-btn--menu-item${option.value === value ? " mr-btn--menu-item-active" : ""}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {option.meta ? <span className="mr-select-menu__meta">{option.meta}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UserPicker({
  organizationId,
  value,
  disabled,
  onChange
}: {
  organizationId: string | null;
  value: UserSearchResult | null;
  disabled?: boolean;
  onChange: (user: UserSearchResult | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);

  useEffect(() => {
    if (!open) return;
    function closeMenu() {
      setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !organizationId) return;
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setSearchError(false);
      api<UserSearchResponse>(`/organizations/${organizationId}/user-search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((result) => {
          if (active) setUsers(result.users);
        })
        .catch((error) => {
          if (!active) return;
          if ((error as any)?.name === "AbortError") return;
          setSearchError(true);
          setUsers([]);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, organizationId, query]);

  useEffect(() => {
    setQuery("");
    setUsers([]);
    setOpen(false);
    onChange(null);
  }, [organizationId]);

  const displayValue = value ? `${value.displayName || value.username} (@${value.username})` : query;

  return (
    <div className="mr-user-picker" onClick={(event) => event.stopPropagation()}>
      <div className="mr-user-picker__input-wrap">
        <IconSearch size={16} />
        <input
          className="mr-input mr-user-picker__input"
          value={displayValue}
          disabled={disabled || !organizationId}
          placeholder="搜索并选择用户"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onChange(null);
            setQuery(event.target.value);
            setOpen(true);
          }}
        />
      </div>
      {open && !disabled && organizationId ? (
        <div className="mr-panel mr-user-picker__popover">
          {loading ? <div className="mr-user-picker__state">正在搜索...</div> : null}
          {!loading && searchError ? <div className="mr-user-picker__state">用户搜索失败</div> : null}
          {!loading && !searchError && users.length === 0 ? <div className="mr-user-picker__state">没有可添加的用户</div> : null}
          {!loading && !searchError && users.length > 0 ? (
            <div className="mr-user-picker__list" role="listbox">
              {users.map((user) => (
                <button
                  key={user.id}
                  className="mr-btn mr-btn--menu-item mr-user-picker__option"
                  type="button"
                  role="option"
                  aria-selected={value?.id === user.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(user);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <span className="mr-user-picker__name">{user.displayName || user.username}</span>
                  <span className="mr-user-picker__username">@{user.username}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function OrganizationsPage() {
  const router = useRouter();
  const [backHref, setBackHref] = useState("/app");
  const [viewer, setViewer] = useState<MeResponse["user"]>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [organizationName, setOrganizationName] = useState("");
  const [selectedMemberUser, setSelectedMemberUser] = useState<UserSearchResult | null>(null);
  const [memberRole, setMemberRole] = useState<OrganizationRole>("member");
  const [deletingMember, setDeletingMember] = useState<OrganizationMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setBackHref(sanitizeWorkbenchHref(localStorage.getItem("mr_last_workbench_url")));
  }, []);

  async function load() {
    const me = await api<MeResponse>("/me");
    setViewer(me.user);
    if (!me.user) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const result = await api<OrganizationsResponse>("/organizations/mine");
    setOrganizations(result.organizations);
    setSelectedOrganizationId((current) => current ?? result.organizations[0]?.id ?? null);
  }

  async function loadMembers(organizationId: string) {
    setLoadingMembers(true);
    setError(null);
    try {
      const result = await api<OrganizationMembersResponse>(`/organizations/${organizationId}/members`);
      setMembers(result.members);
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setLoadingMembers(false);
    }
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

  const selectedOrganization = organizations.find((organization) => organization.id === selectedOrganizationId) ?? null;
  const canManage = canManageOrganization(selectedOrganization);

  useEffect(() => {
    setMembers([]);
    setOrganizationName(selectedOrganization?.name ?? "");
    if (!selectedOrganization?.id) return;
    void loadMembers(selectedOrganization.id);
  }, [selectedOrganization?.id]);

  const organizationOptions = useMemo<Array<MenuOption<string>>>(() => organizations.map((organization) => ({
    value: organization.id,
    label: organization.name,
    meta: roleLabel(organization.myRole)
  })), [organizations]);
  const roleOptions = useMemo<Array<MenuOption<OrganizationRole>>>(() => [
    { value: "member", label: "成员" },
    { value: "admin", label: "管理员" },
    { value: "owner", label: "负责人" }
  ], []);

  function replaceMember(next: OrganizationMember) {
    setMembers((prev) => prev.map((member) => (member.userId === next.userId ? next : member)));
  }

  async function saveOrganizationName() {
    if (!selectedOrganization) return;
    const name = organizationName.trim();
    if (!name || name === selectedOrganization.name) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<OrganizationResponse>(`/organizations/${selectedOrganization.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name })
      });
      setOrganizations((prev) => prev.map((organization) => (organization.id === result.organization.id ? { ...organization, name: result.organization.name, updatedAt: result.organization.updatedAt } : organization)));
      setMessage("组织名称已保存。");
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  async function addMember() {
    if (!selectedOrganization || !selectedMemberUser) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<OrganizationMemberResponse>(`/organizations/${selectedOrganization.id}/members`, {
        method: "POST",
        body: JSON.stringify({ username: selectedMemberUser.username, role: memberRole })
      });
      setMembers((prev) => [result.member, ...prev.filter((member) => member.userId !== result.member.userId)]);
      setSelectedMemberUser(null);
      setMemberRole("member");
      setMessage("组织成员已更新。");
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  async function updateMemberRole(member: OrganizationMember, role: OrganizationRole) {
    if (!selectedOrganization) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<OrganizationMemberResponse>(`/organizations/${selectedOrganization.id}/members/${member.userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role })
      });
      replaceMember(result.member);
      setMessage("成员身份已更新。");
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeMember() {
    if (!selectedOrganization || !deletingMember) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api<{ ok: true }>(`/organizations/${selectedOrganization.id}/members/${deletingMember.userId}`, { method: "DELETE" });
      setMembers((prev) => prev.filter((member) => member.userId !== deletingMember.userId));
      setDeletingMember(null);
      setMessage("成员已移除。");
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
              <div className="mr-page__eyebrow">Organization</div>
              <h1 className="mr-page__title">组织设置</h1>
              {selectedOrganization ? <p className="mr-page__lead">当前组织身份：{roleLabel(selectedOrganization.myRole)}</p> : null}
            </div>
            <div className="mr-page__actions">
              {viewer?.globalRole === "admin" ? (
                <Link href="/app/admin" prefetch={false} className="mr-btn mr-page__link">
                  管理员设置
                </Link>
              ) : null}
              <Link href={backHref} prefetch={false} className="mr-btn mr-page__link">
                返回工作台
              </Link>
            </div>
          </div>
        </section>

        {error ? <div className="mr-feedback mr-feedback--error">{error}</div> : null}
        {message ? <div className="mr-feedback mr-feedback--success">{message}</div> : null}

        {organizations.length > 0 ? (
          <div className="mr-page__admin-grid mr-page__admin-grid--organizations">
            <section className="mr-panel mr-page__card">
              <div className="mr-page__section-kicker">Current</div>
              <h2 className="mr-page__section-title">当前组织</h2>
              <div className="mr-page__stack">
                <label className="mr-field">
                  <span className="mr-field__label">选择组织</span>
                  <MenuSelect value={selectedOrganizationId ?? ""} options={organizationOptions} onChange={(value) => setSelectedOrganizationId(value)} />
                </label>
                <label className="mr-field">
                  <span className="mr-field__label">组织名称</span>
                  <input className="mr-input" value={organizationName} disabled={!canManage} onChange={(event) => setOrganizationName(event.target.value)} />
                </label>
                <button className="mr-btn mr-btn--primary" type="button" disabled={busy || !canManage || !organizationName.trim() || organizationName.trim() === selectedOrganization?.name} onClick={() => void saveOrganizationName()}>
                  保存组织名称
                </button>
                {selectedOrganization?.owner ? <div className="mr-page__note">负责人：{selectedOrganization.owner.displayName || selectedOrganization.owner.username} (@{selectedOrganization.owner.username})</div> : null}
              </div>
            </section>

            <section className="mr-panel mr-page__card mr-page__admin-users-card">
              <div className="mr-page__section-kicker">Members</div>
              <h2 className="mr-page__section-title">成员与身份</h2>
              {canManage ? (
                <div className="mr-page__user-row mr-collab-row">
                  <label className="mr-field" style={{ margin: 0 }}>
                    <span className="mr-field__label">用户名</span>
                    <UserPicker organizationId={selectedOrganization?.id ?? null} value={selectedMemberUser} disabled={busy} onChange={setSelectedMemberUser} />
                  </label>
                  <label className="mr-field" style={{ margin: 0 }}>
                    <span className="mr-field__label">身份</span>
                    <MenuSelect value={memberRole} options={roleOptions} onChange={setMemberRole} />
                  </label>
                  <button className="mr-btn mr-btn--primary" type="button" disabled={busy || !selectedMemberUser} onClick={() => void addMember()}>
                    加入组织
                  </button>
                </div>
              ) : null}

              <div className="mr-page__admin-user-list">
                {loadingMembers ? <div className="mr-page__note">正在加载成员…</div> : null}
                {!loadingMembers && members.map((member) => (
                  <div key={member.userId} className="mr-page__user-row">
                    <div>
                      <strong>{member.displayName || member.username}</strong>
                      <div className="mr-page__user-meta">
                        <span>@{member.username}</span>
                        <span>{roleLabel(member.role)}</span>
                        <span>加入于 {formatDate(member.createdAt)}</span>
                      </div>
                    </div>
                    <div className="mr-page__actions">
                      <MenuSelect value={member.role} options={roleOptions} disabled={busy || !canManage} onChange={(value) => void updateMemberRole(member, value)} />
                      <button className="mr-btn mr-btn--danger" type="button" disabled={busy || !canManage || member.userId === viewer?.id} onClick={() => setDeletingMember(member)}>
                        移除
                      </button>
                    </div>
                  </div>
                ))}
                {!loadingMembers && members.length === 0 ? <div className="mr-page__note">当前组织还没有成员。</div> : null}
              </div>
            </section>
          </div>
        ) : (
          <section className="mr-panel mr-page__card">
            <h2 className="mr-page__section-title">还没有可管理的组织</h2>
            <p className="mr-page__note">请先让全局管理员在“管理员设置”中创建组织，并把你加入组织。</p>
          </section>
        )}
      </div>

      <Dialog
        open={Boolean(deletingMember)}
        title="移除组织成员"
        description={deletingMember ? `你将把 @${deletingMember.username} 从当前组织移除。` : undefined}
        onClose={() => {
          if (busy) return;
          setDeletingMember(null);
        }}
        footer={
          <>
            <button type="button" className="mr-btn mr-btn--ghost" disabled={busy} onClick={() => setDeletingMember(null)}>
              取消
            </button>
            <button type="button" className="mr-btn mr-btn--danger" disabled={busy} onClick={() => void removeMember()}>
              {busy ? "处理中…" : "确认移除"}
            </button>
          </>
        }
      >
        <div className="mr-dialog__note mr-dialog__note--danger">移除后，该成员将失去基于组织获得的项目和视频权限。</div>
      </Dialog>
    </main>
  );
}
