"use client";

import Avatar from "boring-avatars";
import Link from "next/link";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "../_components/dialog";

type ApiUser = {
  id: string;
  username: string;
  displayName: string | null;
  avatarObjectKey?: string | null;
  avatarContentType?: string | null;
  avatarPreset?: string | null;
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
type AvatarMode = "preset" | "upload";

type CropState = {
  fileName: string;
  sourceUrl: string;
  offsetX: number;
  offsetY: number;
  zoom: number;
  dragging: boolean;
  dragStartX: number;
  dragStartY: number;
  dragOriginX: number;
  dragOriginY: number;
};

const AVATAR_COLORS = ["#27201c", "#c96442", "#e5b56d", "#6f7f68", "#f2eadb"];
const AVATAR_PRESETS = ["mariner", "cedar", "ember", "linen", "violet"];

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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function avatarPresetName(user: ApiUser | null) {
  return user?.avatarPreset || user?.username || "markreel";
}

function selectableAvatarPreset(user: ApiUser | null) {
  return user?.avatarPreset && AVATAR_PRESETS.includes(user.avatarPreset) ? user.avatarPreset : AVATAR_PRESETS[0]!;
}

function BoringAvatarPreview({ name, className = "", size }: { name: string; className?: string; size?: number }) {
  return (
    <span className={`mr-boring-avatar${className ? ` ${className}` : ""}`}>
      <Avatar name={name} colors={AVATAR_COLORS} variant="beam" size={size ?? 72} square />
    </span>
  );
}

function drawCroppedAvatar(crop: CropState): Promise<File> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 512;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas_context_unavailable"));
        return;
      }
      ctx.fillStyle = "#f2eadb";
      ctx.fillRect(0, 0, size, size);
      const scale = Math.max(size / image.width, size / image.height) * crop.zoom;
      const width = image.width * scale;
      const height = image.height * scale;
      const x = (size - width) / 2 + crop.offsetX * size;
      const y = (size - height) / 2 + crop.offsetY * size;
      ctx.drawImage(image, x, y, width, height);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("avatar_export_failed"));
          return;
        }
        resolve(new File([blob], `avatar-${Date.now()}.png`, { type: "image/png" }));
      }, "image/png");
    };
    image.onerror = () => reject(new Error("avatar_image_unavailable"));
    image.src = crop.sourceUrl;
  });
}

export default function UserSettingsPage() {
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const [backHref, setBackHref] = useState("/app");
  const [user, setUser] = useState<ApiUser | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);
  const [avatarMode, setAvatarMode] = useState<AvatarMode>("preset");
  const [selectedPreset, setSelectedPreset] = useState(AVATAR_PRESETS[0]!);
  const [crop, setCrop] = useState<CropState | null>(null);
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
        setSelectedPreset(selectableAvatarPreset(result.user));
      })
      .catch(() => {
        setUser(null);
        setError("登录已失效，请返回工作台重新登录。");
      });
  }, []);

  useEffect(() => {
    return () => {
      if (crop?.sourceUrl) URL.revokeObjectURL(crop.sourceUrl);
    };
  }, [crop?.sourceUrl]);

  const userName = useMemo(() => user?.displayName?.trim() || user?.username || "U", [user]);
  const roleLabel = user?.globalRole === "admin" ? "管理员" : "普通用户";

  async function updateProfile(args: { avatarObjectKey?: string | null; avatarContentType?: string | null; avatarPreset?: string | null }) {
    if (!user) return null;
    const result = await api<ProfileResponse>("/users/me/profile", {
      method: "PUT",
      body: JSON.stringify({
        displayName: displayName.trim() || null,
        avatarObjectKey: "avatarObjectKey" in args ? args.avatarObjectKey : user.avatarObjectKey ?? null,
        avatarContentType: "avatarContentType" in args ? args.avatarContentType : user.avatarContentType ?? null,
        avatarPreset: "avatarPreset" in args ? args.avatarPreset : user.avatarPreset ?? user.username
      })
    });
    setUser(result.user);
    setDisplayName(result.user.displayName ?? "");
    return result.user;
  }

  async function saveProfile() {
    if (!user) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await updateProfile({});
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

  function onPickAvatar(file: File | null) {
    if (!file) return;
    const sourceUrl = URL.createObjectURL(file);
    setCrop((current) => {
      if (current?.sourceUrl) URL.revokeObjectURL(current.sourceUrl);
      return {
        fileName: file.name,
        sourceUrl,
        offsetX: 0,
        offsetY: 0,
        zoom: 1,
        dragging: false,
        dragStartX: 0,
        dragStartY: 0,
        dragOriginX: 0,
        dragOriginY: 0
      };
    });
    setAvatarMode("upload");
  }

  async function saveAvatarPreset() {
    if (!user) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await updateProfile({ avatarObjectKey: null, avatarContentType: null, avatarPreset: selectedPreset });
      setAvatarDialogOpen(false);
      setCrop(null);
      setMessage("头像已更新。");
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveUploadedAvatar() {
    if (!user || !crop) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const file = await drawCroppedAvatar(crop);
      const presigned = await api<AvatarPresignResponse>("/users/me/avatar/presign", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, contentType: file.type })
      });
      await uploadToPresignedUrl(presigned.upload.url, file);
      await updateProfile({
        avatarObjectKey: presigned.upload.objectKey,
        avatarContentType: presigned.upload.contentType,
        avatarPreset: user.avatarPreset || user.username
      });
      setAvatarDialogOpen(false);
      setCrop(null);
      setMessage("头像已更新。");
    } catch (e) {
      setError(toZhError(e));
    } finally {
      setBusy(false);
      if (avatarFileInputRef.current) avatarFileInputRef.current.value = "";
    }
  }

  function onCropPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!crop) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setCrop((current) => current
      ? {
          ...current,
          dragging: true,
          dragStartX: event.clientX,
          dragStartY: event.clientY,
          dragOriginX: current.offsetX,
          dragOriginY: current.offsetY
        }
      : current);
  }

  function onCropPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    setCrop((current) => {
      if (!current?.dragging) return current;
      return {
        ...current,
        offsetX: clamp(current.dragOriginX + (event.clientX - current.dragStartX) / 320, -0.65, 0.65),
        offsetY: clamp(current.dragOriginY + (event.clientY - current.dragStartY) / 320, -0.65, 0.65)
      };
    });
  }

  function onCropPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (crop?.dragging) event.currentTarget.releasePointerCapture(event.pointerId);
    setCrop((current) => current ? { ...current, dragging: false } : current);
  }

  function onCropWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!crop) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    setCrop((current) => current ? { ...current, zoom: clamp(current.zoom + delta, 1, 3) } : current);
  }

  function closeAvatarDialog() {
    if (busy) return;
    setAvatarDialogOpen(false);
    setAvatarMode("preset");
    setCrop(null);
    setSelectedPreset(selectableAvatarPreset(user));
  }

  return (
    <main className="mr-page">
      <div className="mr-page__shell">
        <section className="mr-panel mr-page__hero">
          <div className="mr-page__hero-head">
            <div>
              <div className="mr-page__eyebrow">User</div>
              <h1 className="mr-page__title">用户设置</h1>
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
                <BoringAvatarPreview name={avatarPresetName(user)} className="mr-page__avatar-fallback" />
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
                <button
                  className="mr-btn"
                  type="button"
                  disabled={busy || !user}
                  onClick={() => {
                    setSelectedPreset(selectableAvatarPreset(user));
                    setAvatarDialogOpen(true);
                  }}
                >
                  更换头像
                </button>
              </div>
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
        open={avatarDialogOpen}
        title="更换头像"
        description="选择一个默认头像，或上传图片后裁切成新的头像。"
        onClose={closeAvatarDialog}
        footer={
          <>
            <button type="button" className="mr-btn mr-btn--ghost" disabled={busy} onClick={closeAvatarDialog}>
              取消
            </button>
            <button
              type="button"
              className="mr-btn mr-btn--primary"
              disabled={busy || (avatarMode === "upload" && !crop)}
              onClick={() => (avatarMode === "preset" ? void saveAvatarPreset() : void saveUploadedAvatar())}
            >
              {busy ? "保存中…" : "保存头像"}
            </button>
          </>
        }
      >
        <div className="mr-avatar-dialog">
          <div className="mr-avatar-dialog__tabs" role="tablist" aria-label="头像来源">
            <button type="button" className={`mr-avatar-dialog__tab${avatarMode === "preset" ? " is-active" : ""}`} onClick={() => setAvatarMode("preset")}>
              默认头像
            </button>
            <button type="button" className={`mr-avatar-dialog__tab${avatarMode === "upload" ? " is-active" : ""}`} onClick={() => setAvatarMode("upload")}>
              自定义上传
            </button>
          </div>

          {avatarMode === "preset" ? (
            <div className="mr-avatar-dialog__preset-grid">
              {AVATAR_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`mr-avatar-dialog__preset${selectedPreset === preset ? " is-active" : ""}`}
                  onClick={() => setSelectedPreset(preset)}
                  aria-label={`选择默认头像 ${preset}`}
                >
                  <BoringAvatarPreview name={preset} size={88} />
                </button>
              ))}
            </div>
          ) : (
            <div className="mr-avatar-dialog__upload">
              <div
                className={`mr-avatar-dialog__cropper${crop ? " has-image" : ""}`}
                onPointerDown={onCropPointerDown}
                onPointerMove={onCropPointerMove}
                onPointerUp={onCropPointerUp}
                onPointerCancel={onCropPointerUp}
                onWheel={onCropWheel}
              >
                {crop ? (
                  <img
                    src={crop.sourceUrl}
                    alt="头像裁切预览"
                    draggable={false}
                    style={{ transform: `translate(${crop.offsetX * 100}%, ${crop.offsetY * 100}%) scale(${crop.zoom})` }}
                  />
                ) : (
                  <div className="mr-avatar-dialog__empty">
                    <BoringAvatarPreview name={avatarPresetName(user)} />
                    <span>选择图片后，拖动画面调整裁切位置。</span>
                  </div>
                )}
              </div>
              <div className="mr-avatar-dialog__crop-actions">
                <button type="button" className="mr-btn" onClick={() => avatarFileInputRef.current?.click()} disabled={busy}>
                  选择图片
                </button>
                <input ref={avatarFileInputRef} type="file" accept="image/*" hidden onChange={(event) => onPickAvatar(event.target.files?.[0] ?? null)} />
                <span className="mr-avatar-dialog__wheel-hint">滚轮缩放，拖动调整位置</span>
              </div>
            </div>
          )}
        </div>
      </Dialog>

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
