"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "../_components/dialog";

type ApiUser = {
  id: string;
  username: string;
  displayName: string | null;
  avatarObjectKey?: string | null;
  avatarContentType?: string | null;
  avatarUrl?: string | null;
  globalRole?: "admin" | "user";
  createdAt?: string;
};

type MeResponse = { user: ApiUser | null };
type ProfileResponse = { user: ApiUser };
type AvatarPresignResponse = {
  upload: {
    method: "PUT";
    url: string;
    objectKey: string;
    bucket: string;
    contentType: string;
  };
};

type DeleteAccountResponse = { ok: true };

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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const res = await fetch(`/api${path}`, {
    ...init,
    headers,
    credentials: "include"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error("api_error"), { status: res.status, data });
  return data as T;
}

function toZhError(e: any) {
  const code = e?.data?.error as string | undefined;
  const map: Record<string, string> = {
    unauthorized: "登录已失效，请重新登录。",
    invalid_credentials: "当前密码不正确。",
    object_storage_unavailable: "对象存储当前不可用，请稍后再试。",
    validation_error: "提交内容不符合要求。",
    not_found: "账号不存在或已被删除。"
  };
  return map[code ?? ""] ?? "请求失败，请稍后重试。";
}

async function uploadToPresignedUrl(url: string, file: File) {
  const res = await fetch(url, {
    method: "PUT",
    body: file,
    headers: file.type ? { "content-type": file.type } : undefined
  });
  if (!res.ok) throw new Error(`upload_failed:${res.status}`);
}

export default function UserSettingsPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [backHref, setBackHref] = useState("/app");
  const [user, setUser] = useState<ApiUser | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBackHref(sanitizeWorkbenchHref(localStorage.getItem("mr_last_workbench_url")));
  }, []);

  useEffect(() => {
    void api<MeResponse>("/me")
      .then((result) => {
        setUser(result.user);
        setDisplayName(result.user?.displayName ?? "");
      })
      .catch(() => {
        setUser(null);
        setError("登录已失效，请返回工作台重新登录。");
      });
  }, []);

  const userName = useMemo(() => user?.displayName?.trim() || user?.username || "U", [user]);
  const avatarInitial = userName[0]?.toUpperCase() ?? "U";
  const roleLabel = user?.globalRole === "admin" ? "管理员" : "普通用户";

  async function saveProfile() {
    if (!user) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<ProfileResponse>("/users/me/profile", {
        method: "PUT",
        body: JSON.stringify({
          displayName: displayName.trim() || null,
          avatarObjectKey: user.avatarObjectKey ?? null,
          avatarContentType: user.avatarContentType ?? null
        })
      });
      setUser(result.user);
      setDisplayName(result.user.displayName ?? "");
      setMessage("资料已保存。");
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  async function changePassword() {
    if (!user) return;
    if (!currentPassword || !newPassword) {
      setError("请填写当前密码和新密码。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<ProfileResponse>("/users/me/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      setUser(result.user);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("密码已更新，其他旧会话会在下次请求时失效。");
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    if (!user) return;
    if (!deletePassword) {
      setError("请输入当前密码后再注销账号。");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api<DeleteAccountResponse>("/users/me/delete-account", {
        method: "POST",
        body: JSON.stringify({ currentPassword: deletePassword })
      });
      setDeleteDialogOpen(false);
      setDeletePassword("");
      setUser(null);
      setMessage("账号已注销，即将返回首页。");
      window.location.href = "/";
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onPickAvatar(file: File | null) {
    if (!user || !file) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const presigned = await api<AvatarPresignResponse>("/users/me/avatar/presign", {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream"
        })
      });
      await uploadToPresignedUrl(presigned.upload.url, file);
      const result = await api<ProfileResponse>("/users/me/profile", {
        method: "PUT",
        body: JSON.stringify({
          displayName: displayName.trim() || null,
          avatarObjectKey: presigned.upload.objectKey,
          avatarContentType: presigned.upload.contentType
        })
      });
      setUser(result.user);
      setDisplayName(result.user.displayName ?? "");
      setMessage("头像已更新。");
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <main className="mr-page">
      <div className="mr-page__shell">
        <section className="mr-panel mr-page__hero">
          <div className="mr-page__hero-head">
            <div>
              <div className="mr-page__eyebrow">User</div>
              <h1 className="mr-page__title">用户设置</h1>
              <p className="mr-page__lead">这里只管理当前登录账号的资料与安全能力，不混入当前浏览器的界面偏好。</p>
            </div>
            <Link href={backHref} prefetch={false} className="mr-btn mr-page__link">
              返回工作台
            </Link>
          </div>
        </section>

        {error ? <div className="mr-feedback mr-feedback--error">{error}</div> : null}
        {message ? <div className="mr-feedback mr-feedback--success">{message}</div> : null}

        <div className="mr-page__grid">
          <section className="mr-panel mr-page__card">
            <div className="mr-page__section-kicker">Profile</div>
            <h2 className="mr-page__section-title">个人资料</h2>
            <p className="mr-page__note">显示用户名、昵称和身份，其中只有昵称可以修改。</p>

            <div className="mr-page__profile-head">
              {user?.avatarUrl ? (
                <img className="mr-page__avatar-image" src={user.avatarUrl} alt="用户头像" />
              ) : (
                <div className="mr-page__avatar-fallback">{avatarInitial}</div>
              )}
              <div className="mr-page__profile-copy">
                <strong>{displayName.trim() || "未设置昵称"}</strong>
                <span>@{user?.username ?? "-"}</span>
                <span>{roleLabel}</span>
              </div>
            </div>

            <div className="mr-page__stack">
              <label className="mr-field">
                <span className="mr-field__label">昵称</span>
                <input className="mr-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="输入新的昵称" />
              </label>

              <div className="mr-page__actions">
                <button className="mr-btn mr-btn--primary" type="button" disabled={busy || !user} onClick={() => void saveProfile()}>
                  保存资料
                </button>
                <button className="mr-btn" type="button" disabled={busy || !user} onClick={() => fileInputRef.current?.click()}>
                  更换头像
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => void onPickAvatar(event.target.files?.[0] ?? null)}
              />
            </div>
          </section>

          <section className="mr-panel mr-page__card">
            <div className="mr-page__section-kicker">Security</div>
            <h2 className="mr-page__section-title">修改密码</h2>
            <p className="mr-page__note">修改密码必须输入旧密码。保存后，当前页面会继续保持登录，其他旧登录状态会失效。</p>

            <div className="mr-page__stack">
              <label className="mr-field">
                <span className="mr-field__label">当前密码</span>
                <input className="mr-input" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
              </label>

              <label className="mr-field">
                <span className="mr-field__label">新密码</span>
                <input className="mr-input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
              </label>

              <label className="mr-field">
                <span className="mr-field__label">确认新密码</span>
                <input className="mr-input" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              </label>

              <div className="mr-page__actions">
                <button className="mr-btn mr-btn--primary" type="button" disabled={busy || !user} onClick={() => void changePassword()}>
                  更新密码
                </button>
              </div>
            </div>
          </section>

          <section className="mr-panel mr-page__card">
            <div className="mr-page__section-kicker">Account</div>
            <h2 className="mr-page__section-title">注销账号</h2>
            <p className="mr-page__note">这是当前账号自己的停用入口。确认后会立即退出登录，并让当前账号所有旧会话一起失效。</p>

            <div className="mr-page__stack">
              <div className="mr-dialog__note mr-dialog__note--danger">确认后会停用这个账号，并立即退出当前以及其他旧登录状态。</div>
              <div className="mr-page__actions">
                <button className="mr-btn mr-btn--danger" type="button" disabled={busy || !user} onClick={() => setDeleteDialogOpen(true)}>
                  注销当前账号
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <Dialog
        open={deleteDialogOpen}
        title="确认注销账号"
        description={user ? `请输入 @${user.username} 的当前密码。确认后会立即退出登录，并停用这个账号。` : undefined}
        onClose={() => {
          if (busy) return;
          setDeleteDialogOpen(false);
          setDeletePassword("");
        }}
        footer={
          <>
            <button
              type="button"
              className="mr-btn mr-btn--ghost"
              disabled={busy}
              onClick={() => {
                setDeleteDialogOpen(false);
                setDeletePassword("");
              }}
            >
              取消
            </button>
            <button type="button" className="mr-btn mr-btn--danger" disabled={busy || !deletePassword} onClick={() => void deleteAccount()}>
              {busy ? "处理中…" : "确认注销"}
            </button>
          </>
        }
      >
        <div className="mr-dialog__stack">
          <label className="mr-field">
            <span className="mr-field__label">当前密码</span>
            <input autoFocus className="mr-input" type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} />
          </label>
          <div className="mr-dialog__note mr-dialog__note--danger">这个操作会软删除你的账号，并立即让当前和其他旧登录状态失效。</div>
        </div>
      </Dialog>
    </main>
  );
}
