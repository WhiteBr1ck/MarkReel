"use client";

import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppShell, UploadPanel } from "./_components/shell";
import type { FolderNode, Project, SortMode, UploadItem, UploadStage, ViewMode, WorkspaceItem } from "./_components/shell";
import { Dialog, NameDialog } from "./_components/dialog";
import { formatBytes, formatDuration } from "./_components/workspaceMock";
import { IconChevron, IconFolder, IconSearch, IconSort, IconVideo } from "./_components/icons";
import { useUiPreferences } from "./_components/theme";
import { api } from "./_components/api";

type ApiUser = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl?: string | null;
  avatarPreset?: string | null;
  globalRole?: "admin" | "user";
};
type WorkspaceResponse = {
  project: Project;
  activeFolderId: string;
  breadcrumbs: Array<{ id: string; name: string }>;
  folderTree: FolderNode;
  items: WorkspaceItem[];
};

type TrashItem = Extract<WorkspaceItem, { kind: "video" }> & {
  deletedAt: number | null;
};

type TrashResponse = {
  items: TrashItem[];
};

type PreviewState = {
  id: string;
  title: string;
  url: string;
};

type AnnotationAttachment = {
  id?: string;
  kind: "image";
  objectKey: string;
  mimeType?: string;
  width?: number;
  height?: number;
  createdAt?: string;
};

type AnnotationRecord = {
  id: string;
  timestampMs: number;
  type: "pin" | "rect" | "text";
  body: string;
  color?: string | null;
  createdAt: string;
  updatedAt: string;
  author?: { id: string; username: string; displayName: string | null };
  attachments: AnnotationAttachment[];
};

type PreviewResponse = {
  preview: {
    url: string;
    fileName: string;
    inline: boolean;
  };
};

type MediaStatusResponse = {
  media: {
    id: string;
    status: string;
  };
};

type ProcessingStatusResponse = {
  media: {
    id: string;
    status: string;
    updatedAt: string;
  };
  processing: {
    state: string;
    progress: number | null;
    failedReason: string | null;
  } | null;
};

type ProjectMemberRole = "owner" | "editor" | "commenter" | "viewer";

type ProjectPermission = "manage" | "upload" | "view";
type ProjectPermissionGrant = {
  id?: string;
  subjectType: "creator" | "organization" | "invited_user";
  subjectUserId: string | null;
  permission: ProjectPermission;
  locked?: boolean;
  user?: { id: string; username: string; displayName: string | null; avatarPreset?: string | null } | null;
};
type ProjectPermissionsResponse = {
  project: { id: string; ownerId: string; organizationId: string | null };
  grants: ProjectPermissionGrant[];
};
type OrganizationMember = { userId: string; username: string; displayName: string | null; avatarPreset?: string | null; role: "owner" | "admin" | "member"; createdAt: string };
type OrganizationMembersResponse = { members: OrganizationMember[] };

type MediaPermission = "manage" | "annotate" | "view";
type MediaPermissionGrant = {
  id?: string;
  subjectType: "creator" | "organization" | "invited_user" | "public";
  subjectUserId: string | null;
  permission: MediaPermission;
  locked?: boolean;
  user?: { id: string; username: string; displayName: string | null; avatarPreset?: string | null } | null;
};
type MediaPermissionsResponse = {
  media: { id: string; projectId: string; creatorId: string | null; organizationId: string | null };
  grants: MediaPermissionGrant[];
};

type PermissionSubject = "organization" | "invited_user" | "public";
type InviteDialogTarget = "project" | "media";
type InviteDraft = { target: InviteDialogTarget; userIds: string[]; query: string };
type ShareExpiry = "1d" | "3d" | "7d" | "30d" | "never";

const PROJECT_PERMISSION_OPTIONS: Array<{ value: ProjectPermission; label: string; description: string }> = [
  { value: "manage", label: "管理", description: "管理项目资料、成员、权限和删除。" },
  { value: "upload", label: "上传", description: "上传素材、整理文件夹并参与标注。" },
  { value: "view", label: "查看", description: "查看项目内容和视频。" }
];

const MEDIA_PERMISSION_OPTIONS: Array<{ value: MediaPermission; label: string; description: string }> = [
  { value: "manage", label: "管理", description: "修改视频资料、权限、分享链接、删除和恢复。" },
  { value: "annotate", label: "标注", description: "查看视频并创建标注、回复和附件。" },
  { value: "view", label: "查看", description: "只查看视频和已有标注。" }
];

function roleLabel(role?: ProjectMemberRole) {
  const labels: Record<ProjectMemberRole, string> = {
    owner: "拥有者",
    editor: "编辑者",
    commenter: "评论者",
    viewer: "只读者"
  };
  return role ? labels[role] : "成员";
}

function canProject(project: Project | null | undefined, capability: string) {
  return !!project?.capabilities?.includes(capability);
}

type SharePermission = "view" | "annotate";
type ShareAudience = "anyone" | "authenticated";

type ProjectShareLink = {
  id: string;
  label: string | null;
  audience: ShareAudience;
  projectId: string | null;
  mediaId: string | null;
  permissions: SharePermission[];
  hasPassword: boolean;
  maxUses: number | null;
  useCount: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  token?: string;
  url?: string;
};

type ShareLinksResponse = { shareLinks: ProjectShareLink[] };
type ShareLinkResponse = { shareLink: ProjectShareLink };

const SHARE_PERMISSION_OPTIONS: Array<{ value: SharePermission; label: string }> = [
  { value: "view", label: "查看" },
  { value: "annotate", label: "标注" }
];

const SHARE_EXPIRY_OPTIONS: Array<{ value: ShareExpiry; label: string; days: number | null }> = [
  { value: "1d", label: "1天", days: 1 },
  { value: "3d", label: "3天", days: 3 },
  { value: "7d", label: "7天", days: 7 },
  { value: "30d", label: "30天", days: 30 },
  { value: "never", label: "永久", days: null }
];

const PROJECT_PERMISSION_RANK: Record<ProjectPermission, number> = { view: 1, upload: 2, manage: 3 };
const MEDIA_PERMISSION_RANK: Record<MediaPermission, number> = { view: 1, annotate: 2, manage: 3 };

function strongestPermission<T extends string>(permissions: T[], rank: Record<T, number>) {
  return permissions.reduce<T | null>((best, permission) => (!best || rank[permission] > rank[best] ? permission : best), null);
}

function memberLabel(member: Pick<OrganizationMember, "username" | "displayName">) {
  return member.displayName?.trim() || member.username;
}

function normalizePermissionGrants<TPermission extends string, TGrant extends { subjectType: string; subjectUserId: string | null; permission: TPermission }>(
  grants: TGrant[],
  rank: Record<TPermission, number>
) {
  const best = new Map<string, TGrant>();
  for (const grant of grants) {
    const key = `${grant.subjectType}:${grant.subjectUserId ?? ""}`;
    const current = best.get(key);
    if (!current || rank[grant.permission] > rank[current.permission]) {
      best.set(key, grant);
    }
  }
  return [...best.values()];
}

function nextProjectPermission(current: ProjectPermission | null, clicked: ProjectPermission) {
  if (current === clicked) return clicked === "view" ? null : "view";
  return clicked;
}

function nextMediaPermission(current: MediaPermission | null, clicked: MediaPermission) {
  if (current === clicked) return clicked === "view" ? null : "view";
  return clicked;
}

function expiryToIso(value: ShareExpiry) {
  const option = SHARE_EXPIRY_OPTIONS.find((item) => item.value === value);
  if (!option?.days) return null;
  const date = new Date();
  date.setDate(date.getDate() + option.days);
  return date.toISOString();
}

type UploadMode = "original" | "compress";
type UploadSource = "local" | "server";
type UploadResolution = "1080p" | "720p";
type UploadFps = "source" | 24 | 25 | 30 | 60;

type UploadDraft = {
  source: UploadSource;
  file: File | null;
  files: File[];
  serverPath: string;
  title: string;
  mode: UploadMode;
  targetResolution: UploadResolution;
  targetFps: UploadFps;
  folderId: string;
};

type ServerImportEntry = {
  name: string;
  path: string;
  kind: "directory" | "file";
  sizeBytes?: number;
  updatedAt: number;
};

type ServerImportBrowseResponse = {
  rootEnabled: boolean;
  path: string;
  parentPath: string | null;
  entries: ServerImportEntry[];
};

type UploadMenuOption = {
  value: string;
  label: string;
};

type UploadMenuProps = {
  value: string;
  options: UploadMenuOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
};

function UploadMenu({ value, options, disabled, onChange }: UploadMenuProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    function closeMenu() {
      setOpen(false);
    }
    window.addEventListener("markreel:close-upload-menus", closeMenu);
    return () => window.removeEventListener("markreel:close-upload-menus", closeMenu);
  }, []);

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

  function toggleOpen() {
    if (!open) window.dispatchEvent(new Event("markreel:close-upload-menus"));
    setOpen((current) => !current);
  }

  return (
    <div className="mr-upload-dialog__menu" onClick={(event) => event.stopPropagation()}>
      <button
        className="mr-btn mr-btn--menu mr-upload-dialog__menu-trigger"
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <span>{selected?.label ?? "请选择"}</span>
        <IconChevron size={16} dir="down" />
      </button>
      {open ? (
        <div className="mr-panel mr-upload-dialog__menu-popover">
          <div className="mr-upload-dialog__menu-list" role="listbox">
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
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type AnnotationListResponse = {
  annotations: AnnotationRecord[];
};

type AttachmentPresignResponse = {
  upload: {
    method: "PUT";
    url: string;
    proxyUrl?: string;
    objectKey: string;
    bucket: string;
  };
};

type FeedbackTone = "info" | "success" | "error";

type FeedbackState = {
  tone: FeedbackTone;
  message: string;
};

const UPLOAD_QUEUE_STORAGE_KEY = "markreel.uploadQueue.v1";

let uploadQueueState: UploadItem[] | null = null;
const uploadQueueSubscribers = new Set<(uploads: UploadItem[]) => void>();

function readStoredUploadQueue() {
  if (typeof window === "undefined") return [] as UploadItem[];
  if (uploadQueueState) return uploadQueueState;
  try {
    const raw = window.sessionStorage.getItem(UPLOAD_QUEUE_STORAGE_KEY);
    uploadQueueState = raw ? JSON.parse(raw) as UploadItem[] : [];
  } catch {
    uploadQueueState = [];
  }
  return uploadQueueState;
}

function writeUploadQueue(next: UploadItem[]) {
  uploadQueueState = next;
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(UPLOAD_QUEUE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Session storage can be unavailable in private or constrained browser contexts.
    }
  }
  uploadQueueSubscribers.forEach((listener) => listener(next));
}

function updateUploadQueue(updater: (current: UploadItem[]) => UploadItem[]) {
  const current = uploadQueueState ?? readStoredUploadQueue();
  const next = updater(current);
  writeUploadQueue(next);
  return next;
}

function getUploadQueueItem(id: string) {
  return (uploadQueueState ?? readStoredUploadQueue()).find((item) => item.id === id) ?? null;
}

function subscribeUploadQueue(listener: (uploads: UploadItem[]) => void) {
  uploadQueueSubscribers.add(listener);
  return () => {
    uploadQueueSubscribers.delete(listener);
  };
}

type ContextMenuState = {
  x: number;
  y: number;
  target:
    | "workspace"
    | "project_area"
    | WorkspaceItem
    | { kind: "folder_tree"; id: string; name: string }
    | { kind: "project"; id: string; name: string; ownerId: string };
};

function uploadToPresignedUrl(
  url: string,
  file: File,
  onProgress?: (stats: { progress: number; loaded: number; total?: number; speedBps?: number; etaSeconds?: number }) => void,
  contentType?: string,
  signal?: AbortSignal
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const samples: Array<{ time: number; loaded: number }> = [];
    let settled = false;

    function rejectOnce(error: Error) {
      if (settled) return;
      settled = true;
      reject(error);
    }

    function resolveOnce() {
      if (settled) return;
      settled = true;
      resolve();
    }

    if (signal?.aborted) {
      rejectOnce(new Error("upload_cancelled"));
      return;
    }

    const onAbort = () => {
      xhr.abort();
      rejectOnce(new Error("upload_cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    function cleanup() {
      signal?.removeEventListener("abort", onAbort);
    }

    xhr.open("PUT", url, true);
    const resolvedContentType = contentType || file.type;
    if (resolvedContentType) xhr.setRequestHeader("Content-Type", resolvedContentType);

    xhr.upload.onprogress = (event) => {
      const now = Date.now();
      samples.push({ time: now, loaded: event.loaded });
      while (samples.length > 2 && now - samples[0].time > 5000) samples.shift();
      const first = samples[0];
      const elapsedSeconds = first ? (now - first.time) / 1000 : 0;
      const speedBps = first && elapsedSeconds > 0 ? Math.max(0, (event.loaded - first.loaded) / elapsedSeconds) : undefined;
      const total = event.lengthComputable ? event.total : file.size || undefined;
      const progress = total ? Math.round((event.loaded / total) * 100) : 0;
      const remainingBytes = total ? Math.max(0, total - event.loaded) : undefined;
      const etaSeconds = remainingBytes != null && speedBps && speedBps > 0 ? remainingBytes / speedBps : undefined;
      onProgress?.({ progress, loaded: event.loaded, total, speedBps, etaSeconds });
    };

    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.({ progress: 100, loaded: file.size, total: file.size });
        resolveOnce();
        return;
      }
      rejectOnce(new Error(`upload_failed:${xhr.status}`));
    };

    xhr.onerror = () => {
      cleanup();
      rejectOnce(new Error("upload_failed:network"));
    };
    xhr.onabort = () => {
      cleanup();
      rejectOnce(new Error("upload_cancelled"));
    };
    xhr.send(file);
  });
}

function shouldFallbackUpload(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message === "upload_failed:network" || message === "upload_failed:0" || message === "upload_failed:403";
}

async function uploadWithFallback(
  upload: { url: string; proxyUrl?: string | null },
  file: File,
  onProgress?: (stats: { progress: number; loaded: number; total?: number; speedBps?: number; etaSeconds?: number }) => void,
  contentType?: string,
  signal?: AbortSignal,
  onFallback?: () => void
) {
  try {
    await uploadToPresignedUrl(upload.url, file, onProgress, contentType, signal);
  } catch (error) {
    if (!upload.proxyUrl || !shouldFallbackUpload(error)) throw error;
    onFallback?.();
    await uploadToPresignedUrl(upload.proxyUrl, file, onProgress, contentType, signal);
  }
}

function toZhError(e: any): string {
  const code = e?.data?.error as string | undefined;
  if (!code) {
    if (e?.status === 500) return "服务器内部错误（请查看 API 控制台日志）";
    return "请求失败";
  }
  const map: Record<string, string> = {
    username_taken: "这个用户名已被占用",
    invalid_credentials: "用户名或密码不正确",
    unauthorized: "未登录或登录已过期",
    public_registration_disabled: "当前实例已关闭公开注册，请联系管理员创建账号",
    account_disabled: "这个账号已被管理员停用",
    database_unavailable: "数据库不可用，请先启动 API 的 SQLite/Prisma 链路",
    internal_server_error: "服务器内部错误（请查看 API 控制台日志）",
    processing_failed: "视频处理失败，请检查 worker、ffmpeg 和对象存储日志",
    queue_unavailable: "压缩队列不可用，请先启动 Redis、worker，并确认 REDIS_URL 可连通",
    server_import_disabled: "服务器路径导入未启用，请先在 Docker 中挂载目录并配置导入根路径",
    invalid_import_path: "服务器路径不在允许的导入目录内",
    import_path_not_found: "服务器路径不存在或无法访问",
    import_path_not_file: "请选择一个视频文件，而不是文件夹",
    server_import_failed: "服务器路径导入失败，请查看 API 日志",
    server_import_timeout: "服务器路径导入超时，请检查挂载目录、MinIO 和视频文件是否可读取"
  };
  return map[code] ?? code;
}

function sortItems(items: WorkspaceItem[], sort: SortMode) {
  const next = [...items];
  if (sort === "name_asc") {
    return next.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }
  if (sort === "name_desc") {
    return next.sort((a, b) => b.name.localeCompare(a.name, "zh-CN"));
  }
  return next.sort((a, b) => b.updatedAt - a.updatedAt);
}

function filterItems(items: WorkspaceItem[], query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return items;
  return items.filter((item) => item.name.toLowerCase().includes(keyword));
}

function formatResolution(item: Extract<WorkspaceItem, { kind: "video" }>) {
  if (!item.width || !item.height) return "分辨率未知";
  return `${item.width}×${item.height}`;
}

function formatFpsValue(frameCount?: number, durationSeconds?: number) {
  if (!frameCount || !durationSeconds || durationSeconds <= 0) return null;
  const fps = frameCount / durationSeconds;
  if (!Number.isFinite(fps) || fps <= 0) return null;
  const rounded = Math.round(fps * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function formatFrames(item: Extract<WorkspaceItem, { kind: "video" }>) {
  const fps = formatFpsValue(item.frameCount, item.durationSeconds);
  if (!fps) return "FPS 未知";
  return `${fps} FPS`;
}

function formatBitrate(item: Extract<WorkspaceItem, { kind: "video" }>) {
  if (!item.bitrateKbps) return "码率未知";
  return `${item.bitrateKbps} kbps`;
}

function formatUploadError(e: any) {
  if (e?.message === "upload_cancelled") return "上传已取消";
  let message = toZhError(e);
  if (typeof e?.message === "string" && e.message.startsWith("upload_failed:")) {
    const detail = e.message.slice("upload_failed:".length);
    if (detail === "network") {
      message = "上传文件失败：网络连接中断，请重试";
    } else if (detail === "499") {
      message = "上传文件失败：连接提前中断，请重新上传";
    } else if (detail === "500") {
      message = "上传文件失败：API 上传代理异常，请查看 API 日志";
    } else if (detail === "503") {
      message = "上传文件失败：对象存储不可用，请确认 MinIO 正在运行";
    } else {
      message = `上传文件失败：服务返回 ${detail}`;
    }
  }
  return message;
}

function stripFileExtension(fileName: string) {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
}

function buildFolderOptions(rootId: string | null, folderTree: FolderNode | null) {
  if (!rootId) return [] as Array<{ id: string; label: string }>;

  const options: Array<{ id: string; label: string }> = [{ id: rootId, label: "根目录" }];

  function walk(nodes: FolderNode[] | undefined, depth: number) {
    if (!nodes?.length) return;
    for (const node of nodes) {
      options.push({
        id: node.id,
        label: `${"　".repeat(depth)}${node.name}`
      });
      walk(node.children, depth + 1);
    }
  }

  walk(folderTree?.children, 0);
  return options;
}

function formatSortLabel(sort: SortMode) {
  const label: Record<SortMode, string> = {
    updated_desc: "最近更新",
    name_asc: "名称 A-Z",
    name_desc: "名称 Z-A"
  };
  return label[sort];
}

function formatViewLabel(view: ViewMode) {
  return view === "grid" ? "网格视图" : "列表视图";
}

function previewGradient(name: string) {
  const palette = ["rgba(70,217,200,0.26)", "rgba(115,132,255,0.18)", "rgba(255,209,102,0.14)"];
  const seed = Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const a = palette[seed % palette.length];
  const b = palette[(seed + 1) % palette.length];
  return `linear-gradient(135deg, ${a}, ${b}), radial-gradient(circle at 20% 20%, rgba(255,255,255,0.2), transparent 42%)`;
}

type VideoCardPreviewProps = {
  name: string;
  previewUrl?: string | null;
};

function VideoCardPreview({ name, previewUrl }: VideoCardPreviewProps) {
  if (!previewUrl) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: previewGradient(name),
          display: "grid",
          placeItems: "center",
          color: "rgba(15,23,42,0.72)"
        }}
      >
        <IconVideo size={26} />
      </div>
    );
  }

  return (
    <video
      src={previewUrl}
      muted
      playsInline
      preload="metadata"
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", background: "#000" }}
    />
  );
}

type DialogState =
  | { type: "create_project"; value: string }
  | { type: "rename_project"; value: string; projectId: string }
  | { type: "create_folder"; value: string }
  | { type: "rename_item"; value: string; targetId: string; targetKind: WorkspaceItem["kind"] }
  | { type: "confirm_delete_project"; projectId: string; projectName: string }
  | { type: "confirm_clear_trash"; projectId: string; projectName: string };

export default function AppClient() {
  const { preferences } = useUiPreferences();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [user, setUser] = useState<ApiUser | null>(null);
  const [workspaces, setWorkspaces] = useState<Project[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [uploadDraft, setUploadDraft] = useState<UploadDraft | null>(null);
  const [serverImportPath, setServerImportPath] = useState("");
  const [serverImportEntries, setServerImportEntries] = useState<ServerImportEntry[]>([]);
  const [serverImportParentPath, setServerImportParentPath] = useState<string | null>(null);
  const [serverImportBusy, setServerImportBusy] = useState(false);
  const [serverImportError, setServerImportError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>(() => readStoredUploadQueue());
  const uploadAborters = useRef(new Map<string, AbortController>());
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [previewBusy, setPreviewBusy] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [projectOrder, setProjectOrder] = useState<string[]>([]);
  const [dragProjectId, setDragProjectId] = useState<string | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [projectPermissionGrants, setProjectPermissionGrants] = useState<ProjectPermissionGrant[]>([]);
  const [organizationMembers, setOrganizationMembers] = useState<OrganizationMember[]>([]);
  const [mediaPermissionsTarget, setMediaPermissionsTarget] = useState<Extract<WorkspaceItem, { kind: "video" }> | null>(null);
  const [mediaPermissionGrants, setMediaPermissionGrants] = useState<MediaPermissionGrant[]>([]);
  const [mediaPermissionMembers, setMediaPermissionMembers] = useState<OrganizationMember[]>([]);
  const [mediaPermissionMeta, setMediaPermissionMeta] = useState<MediaPermissionsResponse["media"] | null>(null);
  const [mediaPermissionsLoading, setMediaPermissionsLoading] = useState(false);
  const [mediaPermissionsSaving, setMediaPermissionsSaving] = useState(false);
  const [inviteDraft, setInviteDraft] = useState<InviteDraft | null>(null);
  const [shareLinksTarget, setShareLinksTarget] = useState<Extract<WorkspaceItem, { kind: "video" }> | null>(null);
  const [shareLinks, setShareLinks] = useState<ProjectShareLink[]>([]);
  const [shareLinksLoading, setShareLinksLoading] = useState(false);
  const [shareLabel, setShareLabel] = useState("");
  const [shareAudience, setShareAudience] = useState<ShareAudience>("anyone");
  const [shareExpiry, setShareExpiry] = useState<ShareExpiry>("7d");
  const [sharePermissions, setSharePermissions] = useState<SharePermission[]>(["view"]);

  const canSubmit = useMemo(() => {
    if (mode === "login") {
      return username.trim().length > 0 && password.length > 0;
    }
    return username.trim().length >= 3 && password.length >= 8;
  }, [mode, username, password]);


  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const pid = sp.get("pid");
  const fid = sp.get("fid");
  const viewRaw = sp.get("view");
  const view: ViewMode = viewRaw === "list" ? "list" : "grid";
  const sortRaw = sp.get("sort");
  const sort: SortMode = sortRaw === "name_asc" || sortRaw === "name_desc" ? sortRaw : "updated_desc";
  const q = sp.get("q") || "";
  const panelParam = sp.get("panel") ?? sp.get("inspector");
  const inspectorPaneOpen = panelParam ? panelParam !== "0" : preferences.defaultInspectorOpen;
  const selectionMode = (sp.get("select") ?? "0") === "1";
  const scope = sp.get("scope") === "trash" ? "trash" : "workspace";
  const sel = sp.get("sel") || "";

  const orderedWorkspaces = useMemo(() => {
    if (projectOrder.length === 0) return workspaces;
    const rank = new Map(projectOrder.map((id, index) => [id, index]));
    return [...workspaces].sort((a, b) => {
      const aRank = rank.get(a.id);
      const bRank = rank.get(b.id);
      if (aRank == null && bRank == null) return 0;
      if (aRank == null) return 1;
      if (bRank == null) return -1;
      return aRank - bRank;
    });
  }, [workspaces, projectOrder]);

  const myProjects = useMemo(() => orderedWorkspaces.filter((project) => project.ownerId === user?.id), [orderedWorkspaces, user?.id]);
  const sharedProjects = useMemo(() => orderedWorkspaces.filter((project) => project.ownerId !== user?.id), [orderedWorkspaces, user?.id]);

  const selectedIds = useMemo(() => {
    const parts = sel.split(",").map((s) => s.trim()).filter(Boolean);
    return new Set(parts);
  }, [sel]);

  useEffect(() => subscribeUploadQueue(setUploads), []);

  function setQuery(next: Record<string, string | null | undefined>) {
    const params = new URLSearchParams(sp.toString());
    params.delete("inspector");
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === undefined || v === "") params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    localStorage.setItem("mr_last_workbench_url", url);
    router.replace(url);
  }

  function getEffectiveWorkspaceId(): string | null {
    if (pid) return pid;
    if (activeWorkspaceId) return activeWorkspaceId;
    if (workspaces[0]?.id) return workspaces[0].id;
    return null;
  }

  const effectivePid = getEffectiveWorkspaceId();
  const rootFid = effectivePid ? `root-${effectivePid}` : null;
  const effectiveFid = fid ?? rootFid;

  async function refreshWorkspace(projectId = effectivePid, folderId = effectiveFid) {
    if (!projectId) {
      setWorkspace(null);
      return null;
    }
    const query = new URLSearchParams();
    if (folderId) query.set("folderId", folderId);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const data = await api<WorkspaceResponse>(`/projects/${projectId}/workspace${suffix}`);
    setWorkspace(data);
    return data;
  }

  async function refreshTrash(projectId = effectivePid) {
    if (!projectId) {
      setTrashItems([]);
      return [];
    }
    const data = await api<TrashResponse>(`/projects/${projectId}/trash`);
    setTrashItems(data.items);
    return data.items;
  }

  async function refreshMe() {
    try {
      const r = await api<{ user: ApiUser }>("/me");
      setUser(r.user);
      setErr(null);
    } catch {
      resetAuthenticatedState();
    }
  }

  function resetAuthenticatedState() {
    setUser(null);
    setWorkspaces([]);
    setActiveWorkspaceId(null);
    setWorkspace(null);
    setDialog(null);
    setUploadDraft(null);
    setUploadQueue(() => []);
    setPreviewUrls({});
    setPreviewBusy(false);
    setFeedback(null);
    setContextMenu(null);
    setSortMenuOpen(false);
    setTrashItems([]);
    setProjectOrder([]);
    setDragProjectId(null);
    setDragOverProjectId(null);
    setCollaborationOpen(false);
    setMembersLoading(false);
    setProjectPermissionGrants([]);
    setOrganizationMembers([]);
    setMediaPermissionsTarget(null);
    setMediaPermissionGrants([]);
    setMediaPermissionMembers([]);
    setMediaPermissionMeta(null);
    setMediaPermissionsLoading(false);
    setMediaPermissionsSaving(false);
    setInviteDraft(null);
    setShareLinksTarget(null);
    setShareLinks([]);
    setShareLinksLoading(false);
    setShareLabel("");
    setShareAudience("anyone");
    setShareExpiry("7d");
    setSharePermissions(["view"]);
    setBusy(false);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("mr_last_workbench_url");
    }
    if (pathname !== "/app" || sp.toString()) {
      router.replace("/app");
    }
  }

  async function refreshWorkspaces() {
    const r = await api<{ projects: Project[] }>("/projects");
    setWorkspaces(r.projects);
    setActiveWorkspaceId((prev) => prev ?? (r.projects[0]?.id ?? null));

    if (!pid && r.projects[0]?.id) {
      setQuery({ pid: r.projects[0].id, fid: `root-${r.projects[0].id}` });
    }
  }

  useEffect(() => {
    void refreshMe();
  }, []);

  useEffect(() => {
    if (!user) return;
    void refreshWorkspaces();
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    const key = `mr_project_order_${user.id}`;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setProjectOrder(parsed.filter((item): item is string => typeof item === "string"));
      }
    } catch {
      setProjectOrder([]);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    const nextIds = workspaces.map((project) => project.id);
    setProjectOrder((prev) => {
      const kept = prev.filter((id) => nextIds.includes(id));
      const missing = nextIds.filter((id) => !kept.includes(id));
      return [...kept, ...missing];
    });
  }, [workspaces, user?.id]);

  useEffect(() => {
    if (!user) return;
    window.localStorage.setItem(`mr_project_order_${user.id}`, JSON.stringify(projectOrder));
  }, [projectOrder, user?.id]);

  useEffect(() => {
    if (!user || !effectivePid) return;
    void refreshWorkspace(effectivePid, effectiveFid);
    void refreshTrash(effectivePid);
  }, [user?.id, effectivePid, effectiveFid]);

  useEffect(() => {
    if (!contextMenu && !sortMenuOpen) return;

    function closeMenu() {
      setContextMenu(null);
      setSortMenuOpen(false);
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("contextmenu", closeMenu);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("contextmenu", closeMenu);
      window.removeEventListener("resize", closeMenu);
    };
  }, [contextMenu, sortMenuOpen]);

  function getCurrentProject() {
    return workspaces.find((project) => project.id === effectivePid) ?? workspace?.project ?? null;
  }

  async function loadProjectMembers(projectId: string) {
    setMembersLoading(true);
    try {
      const result = await api<ProjectPermissionsResponse>(`/projects/${projectId}/permissions`);
      setProjectPermissionGrants(result.grants);
      if (result.project.organizationId) {
        const members = await api<OrganizationMembersResponse>(`/organizations/${result.project.organizationId}/members`);
        setOrganizationMembers(members.members);
      } else {
        setOrganizationMembers([]);
      }
    } catch (e: any) {
      showFeedback("error", toZhError(e));
    } finally {
      setMembersLoading(false);
    }
  }

  function openCollaborationDialog(project: Project | null) {
    if (!project) return;
    setCollaborationOpen(true);
    setProjectPermissionGrants([]);
    setOrganizationMembers([]);
    void loadProjectMembers(project.id);
  }

  function getProjectSubjectPermission(subjectType: "organization" | "invited_user", subjectUserId: string | null = null) {
    return strongestPermission(
      projectPermissionGrants
        .filter((grant) => grant.subjectType === subjectType && (subjectType === "organization" || grant.subjectUserId === subjectUserId))
        .map((grant) => grant.permission),
      PROJECT_PERMISSION_RANK
    );
  }

  function setProjectSubjectPermission(permission: ProjectPermission | null, subjectType: "organization" | "invited_user", subjectUserId: string | null = null) {
    setProjectPermissionGrants((current) => {
      const next = current.filter((grant) => !(grant.subjectType === subjectType && (subjectType === "organization" || grant.subjectUserId === subjectUserId)));
      if (!permission) return next;
      return [...next, { subjectType, subjectUserId: subjectType === "invited_user" ? subjectUserId : null, permission }];
    });
  }

  async function saveProjectPermissions({ close = false } = {}) {
    const project = getCurrentProject();
    if (!project) return;
    setBusy(true);
    try {
      const grants = projectPermissionGrants
        .filter((grant) => grant.subjectType !== "creator")
        .map((grant) => ({ subjectType: grant.subjectType, subjectUserId: grant.subjectUserId, permission: grant.permission }));
      await api<{ ok: true }>(`/projects/${project.id}/permissions`, { method: "PUT", body: JSON.stringify({ grants: normalizePermissionGrants(grants, PROJECT_PERMISSION_RANK) }) });
      await loadProjectMembers(project.id);
      showFeedback("success", "项目权限已保存");
      if (close) setCollaborationOpen(false);
    } catch (e: any) {
      showFeedback("error", toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadMediaPermissions(item: Extract<WorkspaceItem, { kind: "video" }>) {
    setMediaPermissionsLoading(true);
    try {
      const result = await api<MediaPermissionsResponse>(`/media/${item.id}/permissions`);
      setMediaPermissionMeta(result.media);
      setMediaPermissionGrants(result.grants);
      if (result.media.organizationId) {
        const members = await api<OrganizationMembersResponse>(`/organizations/${result.media.organizationId}/members`);
        setMediaPermissionMembers(members.members);
      } else {
        setMediaPermissionMembers([]);
      }
    } catch (e: any) {
      showFeedback("error", toZhError(e));
    } finally {
      setMediaPermissionsLoading(false);
    }
  }

  function openMediaPermissionsDialog(item: Extract<WorkspaceItem, { kind: "video" }>) {
    setMediaPermissionsTarget(item);
    setMediaPermissionMeta(null);
    setMediaPermissionGrants([]);
    setMediaPermissionMembers([]);
    void loadMediaPermissions(item);
  }

  function getMediaSubjectPermission(subjectType: "organization" | "invited_user" | "public", subjectUserId: string | null = null) {
    return strongestPermission(
      mediaPermissionGrants
        .filter((grant) => grant.subjectType === subjectType && (subjectType !== "invited_user" || grant.subjectUserId === subjectUserId))
        .map((grant) => grant.permission),
      MEDIA_PERMISSION_RANK
    );
  }

  function setMediaSubjectPermission(permission: MediaPermission | null, subjectType: "organization" | "invited_user" | "public", subjectUserId: string | null = null) {
    setMediaPermissionGrants((current) => {
      const next = current.filter((grant) => !(grant.subjectType === subjectType && (subjectType !== "invited_user" || grant.subjectUserId === subjectUserId)));
      if (!permission) return next;
      return [...next, { subjectType, subjectUserId: subjectType === "invited_user" ? subjectUserId : null, permission }];
    });
  }

  async function saveMediaPermissions() {
    if (!mediaPermissionsTarget) return;
    setMediaPermissionsSaving(true);
    try {
      const grants = mediaPermissionGrants
        .filter((grant) => grant.subjectType !== "creator")
        .map((grant) => ({ subjectType: grant.subjectType, subjectUserId: grant.subjectUserId, permission: grant.permission }));
      await api<{ ok: true }>(`/media/${mediaPermissionsTarget.id}/permissions`, { method: "PUT", body: JSON.stringify({ grants: normalizePermissionGrants(grants, MEDIA_PERMISSION_RANK) }) });
      await loadMediaPermissions(mediaPermissionsTarget);
      showFeedback("success", "视频权限已保存");
    } catch (e: any) {
      showFeedback("error", toZhError(e));
    } finally {
      setMediaPermissionsSaving(false);
    }
  }

  async function loadMediaShareLinks(mediaId: string) {
    setShareLinksLoading(true);
    try {
      const result = await api<ShareLinksResponse>(`/media/${mediaId}/share-links`);
      setShareLinks(result.shareLinks);
    } catch (e: any) {
      showFeedback("error", toZhError(e));
    } finally {
      setShareLinksLoading(false);
    }
  }

  function resetShareDraft() {
    setShareLabel("");
    setShareAudience("anyone");
    setShareExpiry("7d");
    setSharePermissions(["view"]);
  }

  function openShareLinksDialog(item: Extract<WorkspaceItem, { kind: "video" }>) {
    setShareLinksTarget(item);
    setShareLinks([]);
    resetShareDraft();
    void loadMediaShareLinks(item.id);
  }

  function toggleSharePermission(permission: SharePermission) {
    setSharePermissions((current) => {
      if (current.includes(permission)) {
        const next = current.filter((item) => item !== permission);
        return next.length > 0 ? next : current;
      }
      return [...current, permission];
    });
  }

  function buildShareUrl(link: ProjectShareLink) {
    const path = link.url || `/share/${link.id}`;
    return new URL(path, window.location.origin).toString();
  }

  async function copyShareLink(link: ProjectShareLink) {
    const url = buildShareUrl(link);
    await navigator.clipboard.writeText(url);
    showFeedback("success", "分享链接已复制");
  }

  async function createShareLink() {
    if (!shareLinksTarget) return;
    setBusy(true);
    try {
      const expiresAt = expiryToIso(shareExpiry);
      const result = await api<ShareLinkResponse>(`/media/${shareLinksTarget.id}/share-links`, {
        method: "POST",
        body: JSON.stringify({
          label: shareLabel.trim() || null,
          audience: shareAudience,
          expiresAt,
          permissions: sharePermissions
        })
      });
      setShareLinks((links) => [result.shareLink, ...links]);
      resetShareDraft();
      const url = buildShareUrl(result.shareLink);
      if (url) await navigator.clipboard.writeText(url);
      showFeedback("success", url ? "分享链接已创建并复制" : "分享链接已创建");
    } catch (e: any) {
      showFeedback("error", toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  async function revokeShareLink(link: ProjectShareLink) {
    if (!shareLinksTarget) return;
    setBusy(true);
    try {
      await api<{ ok: true }>(`/media/${shareLinksTarget.id}/share-links/${link.id}`, { method: "DELETE" });
      setShareLinks((links) => links.filter((item) => item.id !== link.id));
      showFeedback("success", "分享链接已撤销");
    } catch (e: any) {
      showFeedback("error", toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleSelected(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setQuery({ sel: Array.from(next).join(",") });
  }

  function clearSelection() {
    setQuery({ sel: null });
  }

  function reorderProjectGroup(groupIds: string[], draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    setProjectOrder((prev) => {
      const order = prev.length > 0 ? [...prev] : workspaces.map((project) => project.id);
      const groupSet = new Set(groupIds);
      const orderedGroup = order.filter((id) => groupSet.has(id));
      const dragIndex = orderedGroup.indexOf(draggedId);
      const targetIndex = orderedGroup.indexOf(targetId);
      if (dragIndex === -1 || targetIndex === -1) return order;

      const nextGroup = [...orderedGroup];
      nextGroup.splice(dragIndex, 1);
      nextGroup.splice(targetIndex, 0, draggedId);

      const next = [...order];
      let groupCursor = 0;
      for (let i = 0; i < next.length; i += 1) {
        if (!groupSet.has(next[i]!)) continue;
        next[i] = nextGroup[groupCursor++]!;
      }
      return next;
    });
    showFeedback("success", "项目顺序已更新");
  }

  function onProjectDragStart(projectId: string, event: ReactDragEvent<HTMLDivElement>) {
    setDragProjectId(projectId);
    setDragOverProjectId(projectId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", projectId);
  }

  function onProjectDragOver(projectId: string, event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverProjectId !== projectId) {
      setDragOverProjectId(projectId);
    }
  }

  function onProjectDrop(projectId: string, groupIds: string[], event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    const draggedId = dragProjectId ?? event.dataTransfer.getData("text/plain");
    if (!draggedId || !groupIds.includes(draggedId) || !groupIds.includes(projectId)) {
      setDragProjectId(null);
      setDragOverProjectId(null);
      return;
    }
    reorderProjectGroup(groupIds, draggedId, projectId);
    setDragProjectId(null);
    setDragOverProjectId(null);
  }

  function onProjectDragEnd() {
    setDragProjectId(null);
    setDragOverProjectId(null);
  }

  function openContextMenu(event: ReactMouseEvent, target: "workspace" | "project_area" | WorkspaceItem | { kind: "folder_tree"; id: string; name: string } | { kind: "project"; id: string; name: string; ownerId: string }) {
    event.preventDefault();
    const menuWidth = 200;
    const menuHeight = target === "workspace" || target === "project_area" ? 56 : 180;
    const x = Math.min(event.clientX, window.innerWidth - menuWidth - 12);
    const y = Math.min(event.clientY, window.innerHeight - menuHeight - 12);
    const nextX = Math.max(12, x);
    const nextY = Math.max(12, y);

    setContextMenu({ x: nextX, y: nextY, target });
  }

  function showFeedback(tone: FeedbackTone, message: string) {
    setFeedback({ tone, message });
  }

  function setUploadQueue(updater: (current: UploadItem[]) => UploadItem[]) {
    updateUploadQueue(updater);
  }

  function getRenameTarget() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return { error: "请先选中一个条目" } as const;
    if (ids.length > 1) return { error: "重命名一次只能处理一个条目" } as const;

    const target = workspace?.items.find((item) => item.id === ids[0]);
    if (!target) return { error: "未找到要重命名的条目" } as const;

    return { target } as const;
  }

  function setUploadError(id: string, message: string) {
    updateUpload(id, { stage: "error", error: message, actionLabel: undefined });
  }

  function setUploadReady(id: string, mediaId: string) {
    updateUpload(id, {
      stage: "ready",
      progress: 100,
      mediaId,
      error: undefined,
      actionLabel: "可预览"
    });
  }

  function isUploadCancelled(id: string) {
    return getUploadQueueItem(id)?.stage === "cancelled";
  }

  async function deletePendingMedia(mediaId?: string) {
    if (!mediaId) return;
    try {
      await api(`/media/${mediaId}`, { method: "DELETE" });
      await Promise.all([refreshWorkspace(effectivePid, effectiveFid), refreshTrash(effectivePid)]);
    } catch {
      // Best-effort cleanup. The queue item remains cancelled even if cleanup fails.
    }
  }

  function cancelUpload(uploadId: string) {
    const target = getUploadQueueItem(uploadId);
    if (!target) return;
    uploadAborters.current.get(uploadId)?.abort();
    updateUpload(uploadId, {
      stage: "cancelled",
      actionLabel: "已取消",
      error: undefined,
      speedBps: undefined,
      etaSeconds: undefined
    });
    void deletePendingMedia(target.mediaId);
    showFeedback("info", `已取消 ${target.fileName}`);
  }

  function wait(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function cachePreviewUrl(mediaId: string) {
    if (previewUrls[mediaId]) return previewUrls[mediaId];
    const data = await api<PreviewResponse>(`/media/${mediaId}/preview`);
    setPreviewUrls((prev) => ({ ...prev, [mediaId]: data.preview.url }));
    return data.preview.url;
  }

  async function warmPreviewUrls(itemsToWarm: WorkspaceItem[]) {
    const targets = itemsToWarm.filter((item): item is Extract<WorkspaceItem, { kind: "video" }> => item.kind === "video");
    if (targets.length === 0) return;

    const nextEntries = await Promise.all(
      targets.map(async (item) => {
        if (previewUrls[item.id]) return null;
        try {
          const url = await cachePreviewUrl(item.id);
          return [item.id, url] as const;
        } catch {
          return null;
        }
      })
    );

    const readyEntries = nextEntries.filter((entry): entry is readonly [string, string] => !!entry);
    if (readyEntries.length === 0) return;
    setPreviewUrls((prev) => ({ ...prev, ...Object.fromEntries(readyEntries) }));
  }

  async function markUploadReady(id: string, mediaId: string) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (isUploadCancelled(id)) return false;
      try {
        const detail = await api<ProcessingStatusResponse>(`/media/${mediaId}/processing-status`);
        const status = detail.media.status;

        if (status === "failed") {
          setUploadError(id, detail.processing?.failedReason || "视频处理失败，请检查 worker、ffmpeg 和对象存储日志");
          return false;
        }

        if (status === "queued") {
          updateUpload(id, {
            stage: "queued",
            progress: 96,
            mediaId,
            actionLabel: "等待 worker 处理"
          });
        } else if (status === "processing") {
          const rawProgress = detail.processing?.progress ?? 10;
          const processingProgress = Math.max(0, Math.min(100, rawProgress));
          updateUpload(id, {
            stage: "transcoding",
            progress: Math.max(96, Math.min(99, 96 + Math.round(processingProgress * 0.03))),
            mediaId,
            actionLabel: `转码中 ${Math.round(processingProgress)}%`
          });
        } else if (status === "uploaded") {
          updateUpload(id, {
            stage: "verifying",
            progress: 95,
            mediaId,
            actionLabel: "读取媒体信息"
          });
        }

        const preview = await api<PreviewResponse>(`/media/${mediaId}/preview`);
        setPreviewUrls((prev) => ({ ...prev, [mediaId]: preview.preview.url }));
        setUploadReady(id, mediaId);
        await refreshWorkspace();
        return true;
      } catch (e: any) {
        if (e?.data?.error === "processing_failed") {
          setUploadError(id, "视频处理失败，请检查 worker、ffmpeg 和对象存储日志");
          return false;
        }

        if (e?.data?.error !== "preview_not_ready" && e?.data?.error !== "not_found") {
          const message = formatUploadError(e);
          setUploadError(id, message);
          return false;
        }

        await wait(1500);
      }
    }

    updateUpload(id, {
      stage: "processing",
      progress: 98,
      mediaId,
      actionLabel: "已上传，等待处理完成"
    });
    return false;
  }

  async function onAuth() {
    setErr(null);
    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password) {
      setErr("请输入用户名和密码");
      return;
    }
    if (mode === "register" && trimmedUsername.length < 3) {
      setErr("用户名至少需要 3 位");
      return;
    }
    if (mode === "register" && password.length < 8) {
      setErr("密码至少需要 8 位");
      return;
    }
    try {
      if (mode === "register") {
        await api("/auth/register", {
          method: "POST",
          body: JSON.stringify({ username: trimmedUsername, password, displayName: displayName || undefined })
        });
      } else {
        await api("/auth/login", { method: "POST", body: JSON.stringify({ username: trimmedUsername, password }) });
      }
      await refreshMe();
    } catch (e: any) {
      setErr(toZhError(e));
    }
  }

  async function onLogout() {
    setErr(null);
    try {
      await api("/auth/logout", { method: "POST", body: "{}" });
    } finally {
      resetAuthenticatedState();
    }
  }

  async function onCreateWorkspace(name: string) {
    setErr(null);
    setBusy(true);
    try {
      await api("/projects", { method: "POST", body: JSON.stringify({ name }) });
      await refreshWorkspaces();
      setDialog(null);
    } catch (e: any) {
      setErr(toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRenameProject(projectId: string, name: string) {
    setErr(null);
    setBusy(true);
    try {
      await api(`/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ name })
      });
      await refreshWorkspaces();
      if (projectId === effectivePid) {
        await refreshWorkspace(projectId, effectiveFid);
      }
      setDialog(null);
      showFeedback("success", "项目名称已更新");
    } catch (e: any) {
      const message = toZhError(e);
      setErr(message);
      showFeedback("error", message);
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteProject(projectId: string, projectName: string) {
    setErr(null);
    setBusy(true);
    try {
      await api(`/projects/${projectId}`, { method: "DELETE" });
      const refreshed = await api<{ projects: Project[] }>("/projects");
      setWorkspaces(refreshed.projects);
      const nextProjectId = refreshed.projects[0]?.id ?? null;
      setActiveWorkspaceId(nextProjectId);
      setContextMenu(null);
      setDialog(null);
      if (!nextProjectId) {
        setWorkspace(null);
        setTrashItems([]);
        setQuery({ pid: null, fid: null, scope: null, q: null, sel: null });
      } else if (projectId === effectivePid) {
        setQuery({ pid: nextProjectId, fid: `root-${nextProjectId}`, scope: null, q: null, sel: null });
      }
      showFeedback("success", `已删除项目 ${projectName}`);
    } catch (e: any) {
      const message = toZhError(e);
      setErr(message);
      showFeedback("error", message);
    } finally {
      setBusy(false);
    }
  }

  async function onCreateFolder(name: string) {
    if (!effectivePid) return;
    setErr(null);
    setBusy(true);
    try {
      await api(`/projects/${effectivePid}/folders`, {
        method: "POST",
        body: JSON.stringify({
          name,
          parentId: effectiveFid === rootFid ? null : effectiveFid
        })
      });
      await refreshWorkspace(effectivePid, effectiveFid);
      setDialog(null);
    } catch (e: any) {
      setErr(toZhError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRenameSelected(name: string, targetId?: string, targetKind?: WorkspaceItem["kind"]) {
    if (!targetId || !targetKind) {
      const resolved = getRenameTarget();
      const message = resolved.error;
      if (message) {
        showFeedback("error", message);
        return;
      }
      targetId = resolved.target.id;
      targetKind = resolved.target.kind;
    }

    setErr(null);
    setBusy(true);
    try {
      if (targetKind === "folder") {
        await api(`/folders/${targetId}`, {
          method: "PATCH",
          body: JSON.stringify({ name })
        });
      } else {
        await api(`/media/${targetId}`, {
          method: "PATCH",
          body: JSON.stringify({ title: name })
        });
      }
      clearSelection();
      setDialog(null);
      showFeedback("success", "名称已更新");
      await refreshWorkspace(effectivePid, effectiveFid);
    } catch (e: any) {
      const message = toZhError(e);
      setErr(message);
      showFeedback("error", message);
    } finally {
      setBusy(false);
    }
  }

  function openCreateFolderDialog() {
    setDialog({ type: "create_folder", value: "新建文件夹" });
  }

  function openUploadDialog() {
    if (!effectivePid || !rootFid) return;
    setUploadDraft({
      source: "local",
      file: null,
      files: [],
      serverPath: "",
      title: "",
      mode: "compress",
      targetResolution: "1080p",
      targetFps: 30,
      folderId: effectiveFid ?? rootFid
    });
    setServerImportPath("");
    setServerImportEntries([]);
    setServerImportParentPath(null);
    setServerImportError(null);
  }

  function openCreateWorkspaceDialog() {
    setDialog({ type: "create_project", value: "新建项目" });
  }

  function openRenameDialog() {
    const resolved = getRenameTarget();
    const message = resolved.error;
    if (message) {
      showFeedback("error", message);
      return;
    }

    const target = resolved.target;
    setDialog({ type: "rename_item", value: target.name, targetId: target.id, targetKind: target.kind });
  }

  function openRenameForItem(item: WorkspaceItem) {
    setDialog({ type: "rename_item", value: item.name, targetId: item.id, targetKind: item.kind });
  }

  function openDeleteProjectDialog(projectId: string, projectName: string) {
    setDialog({ type: "confirm_delete_project", projectId, projectName });
  }

  function openClearTrashDialog(projectId: string, projectName: string) {
    setDialog({ type: "confirm_clear_trash", projectId, projectName });
  }

  function updateUpload(id: string, patch: Partial<UploadItem>) {
    setUploadQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function openItem(item: WorkspaceItem) {
    if (selectionMode) {
      toggleSelected(item.id);
      return;
    }

    if (item.kind === "folder") {
      setQuery({ fid: item.id, q: null, sel: null });
      return;
    }

    setErr(null);
    setPreviewBusy(true);
    try {
      const data = await api<PreviewResponse>(`/media/${item.id}/preview`);
      setUploadQueue((prev) => prev.map((upload) => (upload.mediaId === item.id ? { ...upload, stage: "ready", progress: 100, error: undefined, actionLabel: "可预览" } : upload)));
      localStorage.setItem("mr_last_workbench_url", `${pathname}?${sp.toString()}` || pathname);
      router.push(`/app/player?mid=${encodeURIComponent(item.id)}`);
      showFeedback("success", `已打开 ${item.name}`);
      setPreviewUrls((prev) => ({ ...prev, [item.id]: data.preview.url }));
    } catch (e: any) {
      const code = e?.data?.error;
      const message = code === "preview_not_ready" ? "该视频还在处理中，暂时还不能预览。" : toZhError(e);
      setErr(message);
      showFeedback(code === "preview_not_ready" ? "info" : "error", message);
    } finally {
      setPreviewBusy(false);
    }
  }

  async function handleItemClick(item: WorkspaceItem) {
    if (scope === "trash" && item.kind === "video") {
      await onDownloadItem(item as TrashItem);
      return;
    }
    await openItem(item);
  }

  async function openUploadItem(mediaId: string) {
    const target = workspace?.items.find((item) => item.id === mediaId) ?? null;
    if (target && target.kind === "video") {
      await openItem(target);
      return;
    }

    setErr(null);
    setPreviewBusy(true);
    try {
      const data = await api<PreviewResponse>(`/media/${mediaId}/preview`);
      const title = uploads.find((upload) => upload.mediaId === mediaId)?.fileName ?? "预览";
      setUploadQueue((prev) => prev.map((upload) => (upload.mediaId === mediaId ? { ...upload, stage: "ready", progress: 100, error: undefined, actionLabel: "可预览" } : upload)));
      localStorage.setItem("mr_last_workbench_url", `${pathname}?${sp.toString()}` || pathname);
      router.push(`/app/player?mid=${encodeURIComponent(mediaId)}`);
      showFeedback("success", `已打开 ${title}`);
      setPreviewUrls((prev) => ({ ...prev, [mediaId]: data.preview.url }));
    } catch (e: any) {
      const code = e?.data?.error;
      const message = code === "preview_not_ready" ? "该视频还在处理中，暂时还不能预览。" : toZhError(e);
      setErr(message);
      showFeedback(code === "preview_not_ready" ? "info" : "error", message);
    } finally {
      setPreviewBusy(false);
    }
  }

  async function loadAnnotations(mediaId: string) {
    const data = await api<AnnotationListResponse>(`/media/${mediaId}/annotations`);
    return data.annotations;
  }

  async function uploadAnnotationAttachment(file: File): Promise<AnnotationAttachment> {
    const data = await api<AttachmentPresignResponse>("/attachments/presign", {
      method: "POST",
      body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream" })
    });
    await uploadWithFallback(data.upload, file);
    return {
      kind: "image",
      objectKey: data.upload.objectKey,
      mimeType: file.type || undefined
    };
  }

  async function createAnnotation(
    mediaId: string,
    input: { timestampMs: number; type: "pin" | "text"; body: string; color: string; attachments: AnnotationAttachment[] }
  ) {
    await api(`/media/${mediaId}/annotations`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  async function onDeleteSelected() {
    const ids = Array.from(selectedIds);
    if (!workspace || ids.length === 0) {
      showFeedback("error", "请先选中要删除的项目");
      return;
    }

    setBusy(true);
    setErr(null);
    try {
      for (const id of ids) {
        const target = workspace.items.find((item) => item.id === id);
        if (!target) continue;
        if (target.kind === "folder") {
          await api(`/folders/${target.id}`, { method: "DELETE" });
        } else {
          await api(`/media/${target.id}`, { method: "DELETE" });
        }
      }
      clearSelection();
      showFeedback("success", `已删除 ${ids.length} 项`);
      await Promise.all([refreshWorkspace(effectivePid, effectiveFid), refreshTrash(effectivePid)]);
    } catch (e: any) {
      const message = toZhError(e);
      setErr(message);
      showFeedback("error", message);
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteItem(item: WorkspaceItem) {
    setBusy(true);
    setErr(null);
    try {
      if (item.kind === "folder") {
        await api(`/folders/${item.id}`, { method: "DELETE" });
      } else {
        await api(`/media/${item.id}`, { method: "DELETE" });
      }
      setContextMenu(null);
      showFeedback("success", `已删除 ${item.name}`);
      await Promise.all([refreshWorkspace(effectivePid, effectiveFid), refreshTrash(effectivePid)]);
    } catch (e: any) {
      const message = toZhError(e);
      setErr(message);
      showFeedback("error", message);
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteFolderTreeItem(folderId: string, folderName: string) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/folders/${folderId}`, { method: "DELETE" });
      setContextMenu(null);
      if (effectiveFid === folderId) {
        setQuery({ fid: rootFid, q: null, sel: null });
      }
      showFeedback("success", `已删除 ${folderName}`);
      await refreshWorkspace(effectivePid, effectiveFid === folderId ? rootFid : effectiveFid);
    } catch (e: any) {
      const message = toZhError(e);
      setErr(message);
      showFeedback("error", message);
    } finally {
      setBusy(false);
    }
  }

  async function onRestoreItem(item: TrashItem) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/media/${item.id}/restore`, { method: "POST", body: "{}" });
      showFeedback("success", `已恢复 ${item.name}`);
      await Promise.all([refreshTrash(effectivePid), refreshWorkspace(effectivePid, effectiveFid)]);
    } catch (e: any) {
      const message = toZhError(e);
      setErr(message);
      showFeedback("error", message);
    } finally {
      setBusy(false);
    }
  }

  async function onClearTrash() {
    if (!effectivePid) return;
    setBusy(true);
    setErr(null);
    try {
      const data = await api<{ ok: true; deleted: number }>(`/projects/${effectivePid}/trash`, { method: "DELETE" });
      showFeedback("success", data.deleted > 0 ? `已彻底删除 ${data.deleted} 个回收站视频` : "回收站已经是空的");
      await Promise.all([refreshTrash(effectivePid), refreshWorkspace(effectivePid, effectiveFid)]);
      setContextMenu(null);
      setDialog(null);
    } catch (e: any) {
      const message = toZhError(e);
      setErr(message);
      showFeedback("error", message);
    } finally {
      setBusy(false);
    }
  }

  async function onDownloadItem(item: Extract<WorkspaceItem, { kind: "video" }> | TrashItem) {
    setErr(null);
    try {
      const data = await api<{ download: { url: string } }>(`/media/${item.id}/download`);
      window.open(data.download.url, "_blank", "noopener,noreferrer");
      showFeedback("success", `已生成 ${item.name} 的下载链接`);
    } catch (e: any) {
      const message = toZhError(e);
      setErr(message);
      showFeedback("error", message);
    }
  }

  function handleContextMenuAction(action: "create_folder" | "rename" | "delete" | "open" | "download" | "restore" | "create_project" | "video_permissions" | "video_share_links") {
    const target = contextMenu?.target ?? null;
    setContextMenu(null);

    if (action === "create_project") {
      openCreateWorkspaceDialog();
      return;
    }

    if (action === "create_folder") {
      openCreateFolderDialog();
      return;
    }

    if (!target || target === "workspace" || target === "project_area") return;

    if (target.kind === "project") {
      if (action === "open") {
        setQuery({ pid: target.id, fid: `root-${target.id}`, scope: null, q: null, sel: null });
        return;
      }

      if (action === "rename") {
        setDialog({ type: "rename_project", value: target.name, projectId: target.id });
        return;
      }

      if (action === "delete") {
        openDeleteProjectDialog(target.id, target.name);
      }
      return;
    }

    if (target.kind === "folder_tree") {
      if (action === "open") {
        setQuery({ fid: target.id, q: null, sel: null });
        return;
      }

      if (action === "rename") {
        setDialog({ type: "rename_item", value: target.name, targetId: target.id, targetKind: "folder" });
        return;
      }

      if (action === "delete") {
        void onDeleteFolderTreeItem(target.id, target.name);
      }
      return;
    }

    if (action === "rename") {
      openRenameForItem(target);
      return;
    }

    if (action === "delete") {
      void onDeleteItem(target);
      return;
    }

    if (action === "download" && target.kind === "video") {
      void onDownloadItem(target);
      return;
    }

    if (action === "video_permissions" && target.kind === "video") {
      openMediaPermissionsDialog(target);
      return;
    }

    if (action === "video_share_links" && target.kind === "video") {
      openShareLinksDialog(target);
      return;
    }

    if (action === "restore" && scope === "trash" && target.kind === "video") {
      void onRestoreItem(target as TrashItem);
      return;
    }

    void openItem(target);
  }

  function clearUploadHistory() {
    setUploadQueue((prev) => prev.filter((item) => item.stage !== "ready" && item.stage !== "error" && item.stage !== "cancelled"));
    showFeedback("success", "已清空上传记录");
  }

  async function uploadSingleFile(args: { draft: UploadDraft; file: File; title: string; uploadId: string }) {
    const { draft, file, title, uploadId } = args;
    const controller = new AbortController();
    uploadAborters.current.set(uploadId, controller);
    let mediaId: string | undefined;
    try {
      if (isUploadCancelled(uploadId)) return false;
      updateUpload(uploadId, { stage: "preparing", progress: 5, actionLabel: "准备上传" });

      const created = await api<{ media: { id: string } }>(`/projects/${effectivePid}/media`, {
        method: "POST",
        body: JSON.stringify({
          title,
          folderId: draft.folderId === rootFid ? null : draft.folderId
        })
      });
      mediaId = created.media.id;

      if (isUploadCancelled(uploadId)) {
        void deletePendingMedia(mediaId);
        return false;
      }

      updateUpload(uploadId, { mediaId: created.media.id, stage: "signing", progress: 12, actionLabel: "获取上传地址" });

      const presigned = await api<{ upload: { url: string; proxyUrl?: string; objectKey: string; mode: "original" | "compress" } }>(
        `/media/${created.media.id}/upload/presign`,
        {
          method: "POST",
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            mode: draft.mode
          })
        }
      );

      if (isUploadCancelled(uploadId)) {
        void deletePendingMedia(mediaId);
        return false;
      }

      updateUpload(uploadId, { stage: "uploading", progress: 18, actionLabel: "正在上传文件" });
      await uploadWithFallback(presigned.upload, file, (stats) => {
        if (isUploadCancelled(uploadId)) return;
        updateUpload(uploadId, {
          stage: "uploading",
          progress: Math.max(18, Math.min(92, stats.progress)),
          actionLabel: "正在上传文件",
          bytesUploaded: stats.loaded,
          totalBytes: stats.total,
          speedBps: stats.speedBps,
          etaSeconds: stats.etaSeconds
        });
      }, file.type || "application/octet-stream", controller.signal, () => {
        if (!isUploadCancelled(uploadId)) updateUpload(uploadId, { actionLabel: "直传不可用，切换代理上传" });
      });

      if (isUploadCancelled(uploadId)) {
        void deletePendingMedia(mediaId);
        return false;
      }

      updateUpload(uploadId, {
        stage: "verifying",
        progress: 94,
        bytesUploaded: file.size,
        totalBytes: file.size,
        speedBps: undefined,
        etaSeconds: undefined,
        actionLabel: "读取媒体信息"
      });
      await api(`/media/${created.media.id}/process`, {
        method: "POST",
        body: JSON.stringify({
          mode: presigned.upload.mode,
          originalObjectKey: presigned.upload.objectKey,
          transcode:
            draft.mode === "compress"
              ? {
                  resolution: draft.targetResolution,
                  fps: draft.targetFps
                }
              : undefined
        })
      });

      if (isUploadCancelled(uploadId)) {
        void deletePendingMedia(mediaId);
        return false;
      }

      void markUploadReady(uploadId, created.media.id);
      await refreshWorkspace(effectivePid, draft.folderId);
      return true;
    } catch (e: any) {
      if (e?.message === "upload_cancelled") {
        updateUpload(uploadId, { stage: "cancelled", actionLabel: "已取消", error: undefined, speedBps: undefined, etaSeconds: undefined });
        void deletePendingMedia(mediaId);
        return false;
      }
      const message = formatUploadError(e);
      setErr(message);
      showFeedback("error", message);
      setUploadError(uploadId, message);
      return false;
    } finally {
      uploadAborters.current.delete(uploadId);
    }
  }

  async function onUpload(draft: UploadDraft) {
    if (!effectivePid || !rootFid) return;
    const files = draft.files.length > 0 ? draft.files : draft.file ? [draft.file] : [];
    if (files.length === 0) return;
    setErr(null);
    showFeedback("info", `已加入 ${files.length} 个上传任务`);

    const tasks = files.map((file, index) => {
      const title = files.length === 1 ? draft.title : stripFileExtension(file.name);
      return {
        file,
        title,
        uploadId: `${Date.now()}-${index}-${file.name}`
      };
    });

    setUploadQueue((prev) => [
      ...tasks.map((task) => ({
        id: task.uploadId,
        fileName: task.title,
        progress: 2,
        stage: "preparing" as UploadStage,
        actionLabel: "排队中",
        totalBytes: task.file.size,
        source: "local" as const
      })),
      ...prev
    ].slice(0, 24));

    const concurrency = 2;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        const task = tasks[index];
        if (!task) return;
        await uploadSingleFile({ draft, file: task.file, title: task.title, uploadId: task.uploadId });
      }
    });
    void Promise.all(workers).then(() => {
      showFeedback("success", "上传请求已完成，正在为新素材刷新工作台");
    });
  }

  async function browseServerImport(path = "") {
    setServerImportBusy(true);
    setServerImportError(null);
    try {
      const data = await api<ServerImportBrowseResponse>(`/server-import/browse?path=${encodeURIComponent(path)}`);
      setServerImportPath(data.path);
      setServerImportParentPath(data.parentPath);
      setServerImportEntries(data.entries);
    } catch (e: any) {
      setServerImportEntries([]);
      setServerImportParentPath(null);
      setServerImportError(toZhError(e));
    } finally {
      setServerImportBusy(false);
    }
  }

  function selectServerImportFile(entry: ServerImportEntry) {
    if (entry.kind !== "file") return;
    setUploadDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        serverPath: entry.path,
        title: prev.title.trim() ? prev.title : stripFileExtension(entry.name)
      };
    });
  }

  async function onServerImport(draft: UploadDraft) {
    if (!effectivePid || !rootFid || !draft.serverPath) return;
    setErr(null);
    showFeedback("info", "已加入 1 个服务器导入任务");

    const uploadId = `${Date.now()}-server-${draft.serverPath}`;
    setUploadQueue((prev) => [
      {
        id: uploadId,
        fileName: draft.title,
        progress: 8,
        stage: "preparing" as UploadStage,
        actionLabel: "准备导入",
        source: "server" as const
      },
      ...prev
    ].slice(0, 12));

    try {
      updateUpload(uploadId, { stage: "importing", progress: 35, actionLabel: "正在从服务器路径导入" });
      const imported = await api<{ media: { id: string }; queued: boolean }>(`/projects/${effectivePid}/media/import/server`, {
        method: "POST",
        body: JSON.stringify({
          path: draft.serverPath,
          title: draft.title,
          folderId: draft.folderId === rootFid ? null : draft.folderId,
          mode: draft.mode,
          transcode:
            draft.mode === "compress"
              ? {
                  resolution: draft.targetResolution,
                  fps: draft.targetFps
                }
              : undefined
        })
      });

      updateUpload(uploadId, {
        mediaId: imported.media.id,
        stage: imported.queued ? "queued" : "verifying",
        progress: 96,
        actionLabel: draft.mode === "compress" ? "已导入，等待处理" : "已导入，正在刷新预览"
      });
      void markUploadReady(uploadId, imported.media.id);
      await refreshWorkspace(effectivePid, draft.folderId);
      showFeedback("success", "服务器路径导入已完成，正在刷新工作台");
    } catch (e: any) {
      const message = formatUploadError(e);
      setErr(message);
      showFeedback("error", message);
      setUploadError(uploadId, message);
    }
  }

  function isUploadHiddenFromWorkspace(item: WorkspaceItem) {
    if (item.kind !== "video") return false;
    return uploads.some((upload) => upload.mediaId === item.id && upload.stage !== "ready" && upload.stage !== "error" && upload.stage !== "cancelled");
  }

  useEffect(() => {
    if (!uploadDraft || uploadDraft.source !== "server" || serverImportEntries.length > 0 || serverImportBusy || serverImportError) return;
    void browseServerImport("");
  }, [uploadDraft?.source, serverImportEntries.length, serverImportBusy, serverImportError]);


  const items: WorkspaceItem[] = useMemo(() => sortItems(filterItems(workspace?.items ?? [], q), sort), [workspace, q, sort]);
  const filteredTrashItems = useMemo(() => sortItems(filterItems(trashItems, q), sort), [trashItems, q, sort]);
  const visibleItems = useMemo(() => scope === "trash" ? filteredTrashItems : items.filter((item) => !isUploadHiddenFromWorkspace(item)), [filteredTrashItems, items, scope, uploads]);
  const crumbs = workspace?.breadcrumbs ?? [];
  const folderOptions = useMemo(() => buildFolderOptions(rootFid, workspace?.folderTree ?? null), [rootFid, workspace?.folderTree]);

  useEffect(() => {
    const visibleVideos = items.slice(0, view === "grid" ? 8 : 4);
    void warmPreviewUrls(visibleVideos);
  }, [items, view]);

  const folderTree = workspace?.folderTree ?? null;
  const currentFolderName = crumbs.at(-1)?.name ?? "根目录";
  const parentFolderId = crumbs.length > 1 ? crumbs[crumbs.length - 2]?.id ?? rootFid : rootFid;
  const canGoUpFolder = scope === "workspace" && effectivePid != null && effectiveFid != null && effectiveFid !== rootFid;
  const currentProject = workspaces.find((project) => project.id === effectivePid) ?? workspace?.project ?? null;
  const canEditAssets = canProject(currentProject, "project:edit_assets");
  const canDeleteProject = canProject(currentProject, "project:delete");
  const canManageProjectPermissions = canProject(currentProject, "project:manage_members");
  const invitedOrganizationMembers = organizationMembers.filter((member) => member.userId !== currentProject?.ownerId);
  const projectInvitedMembers = invitedOrganizationMembers.filter((member) => getProjectSubjectPermission("invited_user", member.userId));
  const mediaInviteCandidates = mediaPermissionMembers.filter((member) => member.userId !== mediaPermissionMeta?.creatorId);
  const mediaInvitedMembers = mediaInviteCandidates.filter((member) => getMediaSubjectPermission("invited_user", member.userId));
  const activeInviteMembers = inviteDraft?.target === "project" ? invitedOrganizationMembers : mediaInviteCandidates;
  const activeInviteSelected = activeInviteMembers.filter((member) => inviteDraft?.userIds.includes(member.userId));
  const activeInviteQuery = inviteDraft?.query.trim().toLowerCase() ?? "";
  const activeInviteOptions = activeInviteMembers
    .filter((member) => {
      const alreadyInvited = inviteDraft?.target === "project" ? getProjectSubjectPermission("invited_user", member.userId) : getMediaSubjectPermission("invited_user", member.userId);
      if (alreadyInvited) return false;
      if (!activeInviteQuery) return true;
      return member.username.toLowerCase().includes(activeInviteQuery) || (member.displayName ?? "").toLowerCase().includes(activeInviteQuery);
    })
    .slice(0, 12);
  const renameState = getRenameTarget();
  const renameDisabled = !workspace || !selectionMode || !canEditAssets || "error" in renameState;
  const renameHint = renameDisabled ? (!canEditAssets ? "当前权限不能修改素材" : "error" in renameState ? renameState.error : "请先进入多选模式") : "重命名当前选中条目";
  const projectOwnerLabel = currentProject?.ownerId === user?.id
    ? (user?.displayName?.trim() || user?.username || "未知")
    : currentProject?.ownerId ?? "未知";
  const projectViewSizeBytes = visibleItems.reduce((sum, item) => sum + (item.kind === "video" ? item.sizeBytes ?? 0 : 0), 0);

  return (
    <main style={{ minHeight: "100vh" }}>
      <NameDialog
        open={dialog?.type === "create_project"}
        title="新建项目"
        description="创建一个新的项目，用来组织视频、文件夹和回收站。"
        label="项目名称"
        placeholder="例如：品牌样片评审"
        value={dialog?.type === "create_project" ? dialog.value : ""}
        submitLabel="创建项目"
        busy={busy}
        onChange={(value) => setDialog((prev) => (prev?.type === "create_project" ? { ...prev, value } : prev))}
        onClose={() => setDialog(null)}
        onSubmit={() => {
          if (dialog?.type !== "create_project") return;
          const name = dialog.value.trim();
          if (!name) return;
          void onCreateWorkspace(name);
        }}
      />

      <NameDialog
        open={dialog?.type === "rename_project"}
        title="重命名项目"
        description="更新当前项目的显示名称。"
        label="项目名称"
        placeholder="输入新的项目名称"
        value={dialog?.type === "rename_project" ? dialog.value : ""}
        submitLabel="保存项目"
        busy={busy}
        onChange={(value) => setDialog((prev) => (prev?.type === "rename_project" ? { ...prev, value } : prev))}
        onClose={() => setDialog(null)}
        onSubmit={() => {
          if (dialog?.type !== "rename_project") return;
          const name = dialog.value.trim();
          if (!name) return;
          void onRenameProject(dialog.projectId, name);
        }}
      />

      <NameDialog
        open={dialog?.type === "create_folder"}
        title="新建文件夹"
        description="把当前目录中的视频按镜头、版本或阶段分组整理。"
        label="文件夹名称"
        placeholder="例如：第一轮粗剪"
        value={dialog?.type === "create_folder" ? dialog.value : ""}
        submitLabel="创建文件夹"
        busy={busy}
        onChange={(value) => setDialog((prev) => (prev?.type === "create_folder" ? { ...prev, value } : prev))}
        onClose={() => setDialog(null)}
        onSubmit={() => {
          if (dialog?.type !== "create_folder") return;
          const name = dialog.value.trim();
          if (!name) return;
          void onCreateFolder(name);
        }}
      />

      <NameDialog
        open={dialog?.type === "rename_item"}
        title="重命名"
        description="更新当前选中条目的展示名称。"
        label="新的名称"
        placeholder="输入新的名称"
        value={dialog?.type === "rename_item" ? dialog.value : ""}
        submitLabel="保存名称"
        busy={busy}
        onChange={(value) => setDialog((prev) => (prev?.type === "rename_item" ? { ...prev, value } : prev))}
        onClose={() => setDialog(null)}
        onSubmit={() => {
          if (dialog?.type !== "rename_item") return;
          const name = dialog.value.trim();
          if (!name) return;
          void onRenameSelected(name, dialog.targetId, dialog.targetKind);
        }}
      />

      <Dialog
        open={dialog?.type === "confirm_delete_project"}
        title="删除项目？"
        description={dialog?.type === "confirm_delete_project" ? `项目“${dialog.projectName}”会被移除，相关工作台内容也会一起删除。此操作不可撤销。` : undefined}
        onClose={() => {
          if (busy) return;
          setDialog(null);
        }}
        footer={
          <>
            <button type="button" className="mr-btn mr-btn--ghost" onClick={() => setDialog(null)} disabled={busy}>
              取消
            </button>
            <button
              type="button"
              className="mr-btn mr-btn--danger"
              onClick={() => {
                if (dialog?.type !== "confirm_delete_project") return;
                void onDeleteProject(dialog.projectId, dialog.projectName);
              }}
              disabled={busy}
            >
              {busy ? "删除中…" : "确认删除"}
            </button>
          </>
        }
      >
        <div className="mr-dialog__stack">
          <div className="mr-dialog__note mr-dialog__note--danger">
            继续后将删除该项目及其当前工作区内容。请先确认这里不是仍在协作中的项目。
          </div>
        </div>
      </Dialog>

      <Dialog
        open={dialog?.type === "confirm_clear_trash"}
        title="清空回收站？"
        description={dialog?.type === "confirm_clear_trash" ? `项目“${dialog.projectName}”回收站里的视频会被永久删除，无法恢复。` : undefined}
        onClose={() => {
          if (busy) return;
          setDialog(null);
        }}
        footer={
          <>
            <button type="button" className="mr-btn mr-btn--ghost" onClick={() => setDialog(null)} disabled={busy}>
              取消
            </button>
            <button
              type="button"
              className="mr-btn mr-btn--danger"
              onClick={() => {
                if (dialog?.type !== "confirm_clear_trash") return;
                void onClearTrash();
              }}
              disabled={busy}
            >
              {busy ? "清空中…" : "确认清空"}
            </button>
          </>
        }
      >
        <div className="mr-dialog__stack">
          <div className="mr-dialog__note mr-dialog__note--danger">
            该操作会永久移除回收站中的所有视频，仅建议在确认不再需要恢复时执行。
          </div>
        </div>
      </Dialog>

      <Dialog
        open={collaborationOpen}
        title="项目协作"
        description={currentProject ? `管理“${currentProject.name}”的项目权限。分享链接只在视频菜单中设置。` : undefined}
        size="wide"
        onClose={() => {
          if (busy) return;
          setCollaborationOpen(false);
        }}
        footer={
          <button type="button" className="mr-btn mr-btn--primary" disabled={busy || membersLoading} onClick={() => canManageProjectPermissions ? void saveProjectPermissions({ close: true }) : setCollaborationOpen(false)}>
            完成
          </button>
        }
      >
        <div className="mr-dialog__stack">
          <div className="mr-permission-panel">
            <div className="mr-permission-panel__head">
              <div>
                <strong>项目权限</strong>
                <span>创建者默认拥有全部权限，不能移除。</span>
              </div>
              <button className="mr-btn mr-btn--primary" type="button" disabled={busy || membersLoading || !canManageProjectPermissions} onClick={() => void saveProjectPermissions()}>
                {busy ? "保存中…" : "保存权限"}
              </button>
            </div>

            {membersLoading ? <div className="mr-page__note">正在加载权限…</div> : null}
            {!membersLoading ? (
              <>
                <div className="mr-permission-table mr-permission-table--project" role="table" aria-label="项目权限矩阵">
                  <div className="mr-permission-table__row mr-permission-table__row--head" role="row">
                    <div role="columnheader">权限</div>
                    <div role="columnheader">创建者</div>
                    <div role="columnheader">组织内</div>
                  </div>
                  {PROJECT_PERMISSION_OPTIONS.map((permission) => {
                    const organizationPermission = getProjectSubjectPermission("organization");
                    const included = organizationPermission ? PROJECT_PERMISSION_RANK[organizationPermission] > PROJECT_PERMISSION_RANK[permission.value] : false;
                    const active = organizationPermission === permission.value;
                    return (
                      <div key={permission.value} className="mr-permission-table__row" role="row">
                        <div className="mr-permission-table__scope" role="cell">
                          <strong>{permission.label}</strong>
                          <span>{permission.description}</span>
                        </div>
                        <div role="cell"><span className="mr-badge mr-badge--accent">锁定</span></div>
                        <div role="cell">
                          <button
                            type="button"
                            className={`mr-permission-toggle${active ? " is-active" : ""}${included ? " is-included" : ""}`}
                            disabled={busy || !canManageProjectPermissions || !currentProject?.organizationId}
                            onClick={() => setProjectSubjectPermission(nextProjectPermission(organizationPermission, permission.value), "organization")}
                            aria-pressed={active || included}
                          >
                            {active ? "已允许" : included ? "已包含" : currentProject?.organizationId ? "未允许" : "无组织"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mr-permission-invite-card">
                  <div>
                    <strong>邀请用户</strong>
                    <span>从当前组织成员中单独授权，不影响组织内默认权限。</span>
                  </div>
                  <button className="mr-btn" type="button" disabled={busy || !canManageProjectPermissions || invitedOrganizationMembers.length === 0} onClick={() => setInviteDraft({ target: "project", userIds: [], query: "" })}>
                    添加邀请用户
                  </button>
                </div>
                {projectInvitedMembers.length > 0 ? (
                  <div className="mr-permission-invite-list">
                    {projectInvitedMembers.map((member) => {
                      const selectedPermission = getProjectSubjectPermission("invited_user", member.userId);
                      return (
                        <div className="mr-permission-invite-row" key={member.userId}>
                          <div>
                            <strong>{memberLabel(member)}</strong>
                            <span>@{member.username}</span>
                          </div>
                          <div className="mr-permission-choice-group">
                            {PROJECT_PERMISSION_OPTIONS.map((permission) => (
                              <button
                                key={permission.value}
                                className={`mr-permission-choice${selectedPermission === permission.value ? " is-active" : ""}${selectedPermission && PROJECT_PERMISSION_RANK[selectedPermission] > PROJECT_PERMISSION_RANK[permission.value] ? " is-included" : ""}`}
                                type="button"
                                disabled={busy || !canManageProjectPermissions}
                                onClick={() => setProjectSubjectPermission(nextProjectPermission(selectedPermission, permission.value), "invited_user", member.userId)}
                              >
                                {permission.label}
                              </button>
                            ))}
                            <button className="mr-permission-choice mr-permission-choice--remove" type="button" disabled={busy || !canManageProjectPermissions} onClick={() => setProjectSubjectPermission(null, "invited_user", member.userId)}>
                              移除
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mr-permission-empty">还没有单独邀请的用户。</div>
                )}
              </>
            ) : null}
          </div>
        </div>
      </Dialog>

      <Dialog
        open={!!mediaPermissionsTarget}
        title="视频权限"
        description={mediaPermissionsTarget ? `设置“${mediaPermissionsTarget.name}”的访问权限。` : undefined}
        size="wide"
        onClose={() => {
          if (mediaPermissionsSaving) return;
          setMediaPermissionsTarget(null);
        }}
        footer={
          <>
            <button type="button" className="mr-btn mr-btn--ghost" disabled={mediaPermissionsSaving} onClick={() => setMediaPermissionsTarget(null)}>
              取消
            </button>
            <button className="mr-btn mr-btn--primary" type="button" disabled={mediaPermissionsSaving || mediaPermissionsLoading} onClick={() => void saveMediaPermissions()}>
              {mediaPermissionsSaving ? "保存中…" : "保存权限"}
            </button>
          </>
        }
      >
        <div className="mr-dialog__stack">
          <div className="mr-permission-panel">
            <div className="mr-permission-panel__head">
              <div>
                <strong>视频权限</strong>
                <span>视频创建者默认拥有全部权限，不能移除。公开权限会允许未登录访问。</span>
              </div>
            </div>
            {mediaPermissionsLoading ? <div className="mr-page__note">正在加载权限…</div> : null}
            {!mediaPermissionsLoading ? (
              <>
                <div className="mr-permission-table mr-permission-table--media" role="table" aria-label="视频权限矩阵">
                  <div className="mr-permission-table__row mr-permission-table__row--head" role="row">
                    <div role="columnheader">权限</div>
                    <div role="columnheader">创建者</div>
                    <div role="columnheader">组织内</div>
                    <div role="columnheader">公开</div>
                  </div>
                  {MEDIA_PERMISSION_OPTIONS.map((permission) => {
                    const organizationPermission = getMediaSubjectPermission("organization");
                    const publicPermission = getMediaSubjectPermission("public");
                    const organizationIncluded = organizationPermission ? MEDIA_PERMISSION_RANK[organizationPermission] > MEDIA_PERMISSION_RANK[permission.value] : false;
                    const publicIncluded = publicPermission ? MEDIA_PERMISSION_RANK[publicPermission] > MEDIA_PERMISSION_RANK[permission.value] : false;
                    const organizationActive = organizationPermission === permission.value;
                    const publicActive = publicPermission === permission.value;
                    return (
                      <div key={permission.value} className="mr-permission-table__row" role="row">
                        <div className="mr-permission-table__scope" role="cell">
                          <strong>{permission.label}</strong>
                          <span>{permission.description}</span>
                        </div>
                        <div role="cell"><span className="mr-badge mr-badge--accent">锁定</span></div>
                        <div role="cell">
                          <button
                            type="button"
                            className={`mr-permission-toggle${organizationActive ? " is-active" : ""}${organizationIncluded ? " is-included" : ""}`}
                            disabled={mediaPermissionsSaving || !mediaPermissionMeta?.organizationId}
                            onClick={() => setMediaSubjectPermission(nextMediaPermission(organizationPermission, permission.value), "organization")}
                            aria-pressed={organizationActive || organizationIncluded}
                          >
                            {organizationActive ? "已允许" : organizationIncluded ? "已包含" : mediaPermissionMeta?.organizationId ? "未允许" : "无组织"}
                          </button>
                        </div>
                        <div role="cell">
                          <button
                            type="button"
                            className={`mr-permission-toggle${publicActive ? " is-active" : ""}${publicIncluded ? " is-included" : ""}`}
                            disabled={mediaPermissionsSaving}
                            onClick={() => setMediaSubjectPermission(nextMediaPermission(publicPermission, permission.value), "public")}
                            aria-pressed={publicActive || publicIncluded}
                          >
                            {publicActive ? "已允许" : publicIncluded ? "已包含" : "未允许"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mr-permission-invite-card">
                  <div>
                    <strong>邀请用户</strong>
                    <span>给组织成员单独设置这个视频的权限。</span>
                  </div>
                  <button className="mr-btn" type="button" disabled={mediaPermissionsSaving || mediaInviteCandidates.length === 0} onClick={() => setInviteDraft({ target: "media", userIds: [], query: "" })}>
                    添加邀请用户
                  </button>
                </div>
                {mediaInvitedMembers.length > 0 ? (
                  <div className="mr-permission-invite-list">
                    {mediaInvitedMembers.map((member) => {
                      const selectedPermission = getMediaSubjectPermission("invited_user", member.userId);
                      return (
                        <div className="mr-permission-invite-row" key={member.userId}>
                          <div>
                            <strong>{memberLabel(member)}</strong>
                            <span>@{member.username}</span>
                          </div>
                          <div className="mr-permission-choice-group">
                            {MEDIA_PERMISSION_OPTIONS.map((permission) => (
                              <button
                                key={permission.value}
                                className={`mr-permission-choice${selectedPermission === permission.value ? " is-active" : ""}${selectedPermission && MEDIA_PERMISSION_RANK[selectedPermission] > MEDIA_PERMISSION_RANK[permission.value] ? " is-included" : ""}`}
                                type="button"
                                disabled={mediaPermissionsSaving}
                                onClick={() => setMediaSubjectPermission(nextMediaPermission(selectedPermission, permission.value), "invited_user", member.userId)}
                              >
                                {permission.label}
                              </button>
                            ))}
                            <button className="mr-permission-choice mr-permission-choice--remove" type="button" disabled={mediaPermissionsSaving} onClick={() => setMediaSubjectPermission(null, "invited_user", member.userId)}>
                              移除
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mr-permission-empty">还没有单独邀请的用户。</div>
                )}
              </>
            ) : null}
          </div>
        </div>
      </Dialog>

      <Dialog
        open={!!inviteDraft}
        title="添加邀请用户"
        description="从当前组织成员中选择用户，添加后可在权限列表里调整级别。"
        onClose={() => setInviteDraft(null)}
        footer={
          <>
            <button type="button" className="mr-btn mr-btn--ghost" onClick={() => setInviteDraft(null)}>
              取消
            </button>
            <button
              type="button"
              className="mr-btn mr-btn--primary"
              disabled={!inviteDraft?.userIds.length}
              onClick={() => {
                if (!inviteDraft?.userIds.length) return;
                if (inviteDraft.target === "project") {
                  for (const userId of inviteDraft.userIds) setProjectSubjectPermission("view", "invited_user", userId);
                } else {
                  for (const userId of inviteDraft.userIds) setMediaSubjectPermission("view", "invited_user", userId);
                }
                setInviteDraft(null);
              }}
            >
              {inviteDraft?.userIds.length ? `添加 ${inviteDraft.userIds.length} 人` : "添加"}
            </button>
          </>
        }
      >
        <div className="mr-invite-dialog">
          <label className="mr-field">
            <span className="mr-field__label">搜索用户</span>
            <input
              autoFocus
              className="mr-input"
              value={inviteDraft?.query ?? ""}
              placeholder="搜索用户名或昵称"
              onChange={(event) => setInviteDraft((current) => current ? { ...current, query: event.target.value } : current)}
            />
          </label>
          <div className="mr-invite-dialog__list">
            {activeInviteOptions.map((member) => (
              <button
                key={member.userId}
                type="button"
                className={`mr-invite-dialog__option${inviteDraft?.userIds.includes(member.userId) ? " is-active" : ""}`}
                onClick={() => setInviteDraft((current) => {
                  if (!current) return current;
                  const exists = current.userIds.includes(member.userId);
                  return { ...current, userIds: exists ? current.userIds.filter((userId) => userId !== member.userId) : [...current.userIds, member.userId] };
                })}
              >
                <span>{memberLabel(member)}</span>
                <small>@{member.username}</small>
              </button>
            ))}
            {activeInviteOptions.length === 0 ? <div className="mr-permission-empty">没有可添加的用户。</div> : null}
          </div>
          {activeInviteSelected.length > 0 ? <div className="mr-page__note">将添加 {activeInviteSelected.length} 人，默认权限为查看。</div> : null}
        </div>
      </Dialog>

      <Dialog
        open={!!shareLinksTarget}
        title="视频分享链接"
        description={shareLinksTarget ? `创建和管理“${shareLinksTarget.name}”的分享链接。` : undefined}
        onClose={() => {
          if (busy) return;
          setShareLinksTarget(null);
        }}
        footer={
          <button type="button" className="mr-btn mr-btn--primary" disabled={busy} onClick={() => setShareLinksTarget(null)}>
            完成
          </button>
        }
      >
        <div className="mr-dialog__stack">
          <div className="mr-page__user-row mr-collab-row mr-share-row">
            <label className="mr-field" style={{ margin: 0 }}>
              <span className="mr-field__label">链接名称</span>
              <input className="mr-input" value={shareLabel} placeholder="例如：客户评审" onChange={(event) => setShareLabel(event.target.value)} />
            </label>
            <label className="mr-field" style={{ margin: 0 }}>
              <span className="mr-field__label">访问范围</span>
              <select className="mr-input" value={shareAudience} onChange={(event) => setShareAudience(event.target.value as ShareAudience)}>
                <option value="anyone">任何人</option>
                <option value="authenticated">仅登录用户</option>
              </select>
            </label>
            <button className="mr-btn mr-btn--primary" type="button" disabled={busy || sharePermissions.length === 0} onClick={() => void createShareLink()}>
              创建并复制
            </button>
          </div>

          <div className="mr-share-options">
            <div className="mr-share-options__group">
              <span className="mr-field__label">有效期</span>
              <div className="mr-share-options__buttons">
                {SHARE_EXPIRY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`mr-permission-choice${shareExpiry === option.value ? " is-active" : ""}`}
                    onClick={() => setShareExpiry(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mr-share-options__group">
              <span className="mr-field__label">权限</span>
              <div className="mr-page__actions">
              {SHARE_PERMISSION_OPTIONS.map((permission) => (
                <button
                  key={permission.value}
                  type="button"
                  className={`mr-btn${sharePermissions.includes(permission.value) ? " mr-btn--primary" : ""}`}
                  onClick={() => toggleSharePermission(permission.value)}
                >
                  {permission.label}
                </button>
              ))}
              </div>
            </div>
          </div>

          <div className="mr-dialog__note">
            新链接创建后会自动复制到剪贴板；已有链接也可以随时重新复制。
          </div>

          <div className="mr-page__stack">
            {shareLinksLoading ? <div className="mr-page__note">正在加载分享链接…</div> : null}
            {!shareLinksLoading && shareLinks.length === 0 ? <div className="mr-page__note">暂无分享链接。</div> : null}
            {shareLinks.map((link) => (
              <div key={link.id} className="mr-page__user-row">
                <div>
                  <strong>{link.label || "未命名链接"}</strong>
                  <div className="mr-page__user-meta">
                    {link.audience === "anyone" ? "任何人" : "仅登录用户"} · {link.permissions.map((permission) => SHARE_PERMISSION_OPTIONS.find((item) => item.value === permission)?.label ?? permission).join("、")}
                    {link.expiresAt ? ` · 过期：${new Date(link.expiresAt).toLocaleString("zh-CN")}` : " · 不过期"}
                  </div>
                </div>
                <div className="mr-page__actions" style={{ justifyContent: "flex-end" }}>
                  <button className="mr-btn" type="button" disabled={busy} onClick={() => void copyShareLink(link)}>
                    复制
                  </button>
                  <button className="mr-btn mr-btn--danger" type="button" disabled={busy} onClick={() => void revokeShareLink(link)}>
                    撤销
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Dialog>

      <Dialog
        open={!!uploadDraft}
        title="上传视频"
        description="选择本地文件或服务器挂载路径，再确认处理参数和目标目录。"
        onClose={() => setUploadDraft(null)}
        footer={
          <>
            <button type="button" className="mr-btn mr-btn--ghost" onClick={() => setUploadDraft(null)}>
              取消
            </button>
            <button
              type="button"
              className="mr-btn mr-btn--primary"
              disabled={!uploadDraft?.title.trim() || !uploadDraft.folderId || (uploadDraft.source === "local" ? uploadDraft.files.length === 0 && !uploadDraft.file : !uploadDraft.serverPath)}
              onClick={() => {
                if (!uploadDraft?.title.trim() || !uploadDraft.folderId) return;
                if (uploadDraft.source === "local" && uploadDraft.files.length === 0 && !uploadDraft.file) return;
                if (uploadDraft.source === "server" && !uploadDraft.serverPath) return;
                const nextDraft = { ...uploadDraft, title: uploadDraft.title.trim() };
                setUploadDraft(null);
                if (nextDraft.source === "server") void onServerImport(nextDraft);
                else void onUpload(nextDraft);
              }}
            >
              {uploadDraft?.source === "server" ? "开始导入" : "开始上传"}
            </button>
          </>
        }
      >
        <div className="mr-upload-dialog">
          <div className="mr-field">
            <span className="mr-field__label">来源</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {([
                ["local", "本地文件"],
                ["server", "服务器路径"]
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`mr-btn${uploadDraft?.source === value ? " mr-btn--primary" : ""}`}
                  onClick={() => setUploadDraft((prev) => (prev ? { ...prev, source: value } : prev))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {uploadDraft?.source === "server" ? (
            <div className="mr-field">
              <span className="mr-field__label">服务器路径</span>
              <div className="mr-panel" style={{ padding: 10, boxShadow: "none", background: "var(--panel3)", display: "grid", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                  <span className="mr-badge">/{serverImportPath}</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="mr-btn" type="button" disabled={!serverImportParentPath || serverImportBusy} onClick={() => void browseServerImport(serverImportParentPath ?? "")}>
                      上一级
                    </button>
                    <button className="mr-btn" type="button" disabled={serverImportBusy} onClick={() => void browseServerImport(serverImportPath)}>
                      刷新
                    </button>
                  </div>
                </div>
                {serverImportError ? <div className="mr-dialog__note">{serverImportError}</div> : null}
                <div style={{ display: "grid", gap: 6, maxHeight: 220, overflow: "auto" }}>
                  {serverImportBusy ? (
                    <div style={{ color: "var(--muted)", padding: 8 }}>正在读取目录…</div>
                  ) : serverImportEntries.length === 0 ? (
                    <div style={{ color: "var(--muted)", padding: 8 }}>没有可显示的文件。</div>
                  ) : (
                    serverImportEntries.map((entry) => {
                      const selected = uploadDraft.serverPath === entry.path;
                      return (
                        <button
                          key={entry.path}
                          type="button"
                          className={`mr-btn${selected ? " mr-btn--primary" : ""}`}
                          style={{ justifyContent: "space-between", textAlign: "left" }}
                          onClick={() => entry.kind === "directory" ? void browseServerImport(entry.path) : selectServerImportFile(entry)}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            {entry.kind === "directory" ? <IconFolder size={16} /> : <IconVideo size={16} />}
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
                          </span>
                          {entry.kind === "file" ? <span style={{ color: selected ? "inherit" : "var(--muted)", fontSize: 12 }}>{formatBytes(entry.sizeBytes)}</span> : null}
                        </button>
                      );
                    })
                  )}
                </div>
                <span className="mr-upload-dialog__hint">
                  {uploadDraft.serverPath ? `已选择：/${uploadDraft.serverPath}` : "请选择一个服务器挂载目录内的视频文件"}
                </span>
              </div>
            </div>
          ) : (
            <label className="mr-field">
              <span className="mr-field__label">选择视频文件</span>
              <input
                className="mr-input mr-upload-dialog__file-input"
                type="file"
                accept="video/*"
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  const file = files[0] ?? null;
                  setUploadDraft((prev) => {
                    if (!prev || !file) return prev;
                    const nextTitle = prev.title.trim() ? prev.title : files.length === 1 ? stripFileExtension(file.name) : `${files.length} 个视频`;
                    return { ...prev, file, files, title: nextTitle };
                  });
                  e.currentTarget.value = "";
                }}
              />
              <span className="mr-upload-dialog__hint">
                {uploadDraft?.files.length ? `已选择 ${uploadDraft.files.length} 个文件` : uploadDraft?.file ? `已选择：${uploadDraft.file.name}` : "暂未选择文件"}
              </span>
            </label>
          )}

          <label className="mr-field">
            <span className="mr-field__label">视频名称</span>
            <input
              className="mr-input"
              value={uploadDraft?.title ?? ""}
              maxLength={200}
              placeholder="输入视频名称"
              onChange={(e) => setUploadDraft((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
            />
          </label>

          <div className="mr-upload-dialog__grid">
            <div className="mr-field">
              <span className="mr-field__label">上传模式</span>
              <UploadMenu
                value={uploadDraft?.mode ?? "compress"}
                options={[
                  { value: "compress", label: "压缩上传" },
                  { value: "original", label: "原始上传" }
                ]}
                onChange={(value) => setUploadDraft((prev) => (prev ? { ...prev, mode: value as UploadMode } : prev))}
              />
            </div>

            <div className="mr-field">
              <span className="mr-field__label">上传目标路径</span>
              <UploadMenu
                value={uploadDraft?.folderId ?? rootFid ?? ""}
                options={folderOptions.map((option) => ({ value: option.id, label: option.label }))}
                onChange={(value) => setUploadDraft((prev) => (prev ? { ...prev, folderId: value } : prev))}
              />
            </div>
          </div>

          <div className={`mr-upload-dialog__grid${uploadDraft?.mode === "compress" ? "" : " mr-upload-dialog__grid--disabled"}`}>
            <div className="mr-field">
              <span className="mr-field__label">压缩分辨率</span>
              <UploadMenu
                value={uploadDraft?.targetResolution ?? "1080p"}
                disabled={uploadDraft?.mode !== "compress"}
                options={[
                  { value: "1080p", label: "1080P" },
                  { value: "720p", label: "720P" }
                ]}
                onChange={(value) => setUploadDraft((prev) => (prev ? { ...prev, targetResolution: value as UploadResolution } : prev))}
              />
            </div>

            <div className="mr-field">
              <span className="mr-field__label">压缩帧率</span>
              <UploadMenu
                value={String(uploadDraft?.targetFps ?? 30)}
                disabled={uploadDraft?.mode !== "compress"}
                options={[
                  { value: "source", label: "保持原帧率" },
                  { value: "24", label: "24 FPS" },
                  { value: "25", label: "25 FPS" },
                  { value: "30", label: "30 FPS" },
                  { value: "60", label: "60 FPS" }
                ]}
                onChange={(value) => {
                  setUploadDraft((prev) => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      targetFps: value === "source" ? "source" : (Number(value) as UploadFps)
                    };
                  });
                }}
              />
            </div>
          </div>

          {uploadDraft?.mode === "original" ? (
            <div className="mr-dialog__note">
              原始上传会保留原始文件，分辨率与帧率选项不会生效。
            </div>
          ) : null}
        </div>
      </Dialog>

      {!user ? (
        <div className="mr-auth">
          <div className="mr-panel mr-auth__card">
            <div className="mr-auth__brand">
              <img src="/logo.png" alt="MarkReel" />
              <div>
                <h1>MarkReel</h1>
                <p>视频审阅工作台</p>
              </div>
            </div>

            <div className="mr-auth__form">
              <div className="mr-auth__tabs" role="tablist" aria-label="登录方式">
                <button className={`mr-btn${mode === "login" ? " mr-btn--primary" : " mr-btn--surface"}`} type="button" onClick={() => setMode("login")}>
                  登录
                </button>
                <button className={`mr-btn${mode === "register" ? " mr-btn--primary" : " mr-btn--surface"}`} type="button" onClick={() => setMode("register")}>
                  注册
                </button>
              </div>

              {err ? <div className="mr-feedback mr-feedback--error">{err}</div> : null}

              <div className="mr-auth__fields">
                <input className="mr-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="用户名" />
                <input
                  className="mr-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="密码 (>= 8 位)"
                  type="password"
                />
              </div>

              {mode === "register" ? (
                <input className="mr-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="昵称 (可选)" />
              ) : null}

              <div className="mr-auth__actions">
                <button className="mr-btn mr-btn--primary" type="button" onClick={() => void onAuth()} disabled={!canSubmit || busy}>
                  {mode === "login" ? "登录" : "创建账号"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <AppShell
          user={user}
          inspectorOpen={inspectorPaneOpen}
          onClearUploads={() => clearUploadHistory()}
          onOpenUploadItem={(mediaId) => void openUploadItem(mediaId)}
          onLogout={() => void onLogout()}
          onGoProjectHome={() => {
            if (!effectivePid) return;
            setQuery({ pid: effectivePid, fid: `root-${effectivePid}`, scope: null, q: null, sel: null });
          }}
          onGoSettings={() => router.push("/app/settings")}
          onGoUserSettings={() => router.push("/app/user-settings")}
          onGoAdminSettings={user.globalRole === "admin" ? () => router.push("/app/admin") : undefined}
          onGoOrganizationSettings={user.globalRole === "admin" ? () => router.push("/app/organizations") : undefined}
          onGoAbout={() => router.push("/app/about")}
          left={
            <>
              <div className="mr-side-section">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.7, textTransform: "uppercase", letterSpacing: 1.1 }}>Projects</div>
                    <div style={{ fontWeight: 900, marginTop: 4 }}>项目列表</div>
                  </div>
                  <button className="mr-btn mr-btn--primary" type="button" onClick={() => openCreateWorkspaceDialog()}>
                    新建项目
                  </button>
                </div>
              </div>

              <div className="mr-side-section" onContextMenu={(event) => openContextMenu(event, "project_area")}>
                <div className="mr-side-section__title">我的项目</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {myProjects.length === 0 ? (
                    <div className="mr-panel" style={{ padding: 12, boxShadow: "none", color: "var(--muted)", lineHeight: 1.6 }}>
                      还没有项目，先创建一个开始整理视频素材。
                    </div>
                  ) : (
                    myProjects.map((project) => {
                      const active = project.id === effectivePid && scope !== "trash";
                      const groupIds = myProjects.map((item) => item.id);
                      const dragging = dragProjectId === project.id;
                      const dragOver = dragOverProjectId === project.id && dragProjectId !== project.id;
                      return (
                        <div
                          key={project.id}
                          className={`mr-project-row${active ? " mr-project-row--active" : ""}${dragging ? " mr-project-row--dragging" : ""}${dragOver ? " mr-project-row--drag-over" : ""}`}
                          draggable
                          onDragStart={(event) => onProjectDragStart(project.id, event)}
                          onDragOver={(event) => onProjectDragOver(project.id, event)}
                          onDrop={(event) => onProjectDrop(project.id, groupIds, event)}
                          onDragEnd={onProjectDragEnd}
                        >
                          <div className="mr-project-row__grip" onClick={(event) => event.stopPropagation()} title="拖动排序" aria-hidden="true">
                            ⋮⋮
                          </div>
                          <button
                            type="button"
                            className="mr-project-row__main"
                            onClick={() => setQuery({ pid: project.id, fid: `root-${project.id}`, scope: null, q: null, sel: null })}
                            title={project.name}
                          >
                            <span className="mr-project-row__name">{project.name}</span>
                          </button>
                          <button
                            type="button"
                            className="mr-project-row__menu"
                            aria-label={`项目菜单：${project.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              const rect = event.currentTarget.getBoundingClientRect();
                              setContextMenu({
                                x: rect.right - 180,
                                y: rect.bottom + 8,
                                target: { kind: "project", id: project.id, name: project.name, ownerId: project.ownerId }
                              });
                            }}
                          >
                            •••
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="mr-side-section">
                <div className="mr-side-section__title">参与项目</div>
                {sharedProjects.length === 0 ? (
                  <div className="mr-panel" style={{ padding: 12, boxShadow: "none", color: "var(--muted)", lineHeight: 1.6 }}>
                    暂无参与项目，后续这里会展示你加入的项目。
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {sharedProjects.map((project) => {
                      const active = project.id === effectivePid && scope !== "trash";
                      const groupIds = sharedProjects.map((item) => item.id);
                      const dragging = dragProjectId === project.id;
                      const dragOver = dragOverProjectId === project.id && dragProjectId !== project.id;
                      return (
                        <div
                          key={project.id}
                          className={`mr-project-row${active ? " mr-project-row--active" : ""}${dragging ? " mr-project-row--dragging" : ""}${dragOver ? " mr-project-row--drag-over" : ""}`}
                          draggable
                          onDragStart={(event) => onProjectDragStart(project.id, event)}
                          onDragOver={(event) => onProjectDragOver(project.id, event)}
                          onDrop={(event) => onProjectDrop(project.id, groupIds, event)}
                          onDragEnd={onProjectDragEnd}
                        >
                          <div className="mr-project-row__grip" onClick={(event) => event.stopPropagation()} title="拖动排序" aria-hidden="true">
                            ⋮⋮
                          </div>
                          <button
                            type="button"
                            className="mr-project-row__main"
                            onClick={() => setQuery({ pid: project.id, fid: `root-${project.id}`, scope: null, q: null, sel: null })}
                            title={project.name}
                          >
                            <span className="mr-project-row__name">{project.name}</span>
                          </button>
                          <button
                            type="button"
                            className="mr-project-row__menu"
                            aria-label={`项目菜单：${project.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              const rect = event.currentTarget.getBoundingClientRect();
                              setContextMenu({
                                x: rect.right - 180,
                                y: rect.bottom + 8,
                                target: { kind: "project", id: project.id, name: project.name, ownerId: project.ownerId }
                              });
                            }}
                          >
                            •••
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          }
          center={
            <>
              {feedback ? <div className={`mr-feedback mr-feedback--${feedback.tone}`}>{feedback.message}</div> : null}
              {!currentProject ? (
                <div className="mr-panel" style={{ padding: 22, boxShadow: "none", minHeight: 280, display: "grid", placeItems: "center", textAlign: "center" }}>
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 20 }}>还没有任何项目</div>
                    <div style={{ marginTop: 10, color: "var(--muted)", lineHeight: 1.7 }}>先在左侧点击“新建项目”，创建一个项目后再上传视频或整理文件夹。</div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mr-panel" style={{ padding: 14, boxShadow: "none", minHeight: 360 }} onContextMenu={(event) => openContextMenu(event, "workspace")}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ opacity: 0.7, fontSize: 12 }}>{scope === "trash" ? "项目回收站" : "项目内容"}</div>
                    <div style={{ fontWeight: 900, marginTop: 6 }}>{currentProject?.name ?? "未选择项目"}</div>
                    {scope === "trash" ? (
                      <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>已删除视频会先进入回收站，可在这里恢复。</div>
                    ) : (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap", color: "var(--muted)", fontSize: 13 }}>
                        <button
                          type="button"
                          className="mr-btn"
                          onClick={() => {
                            if (!canGoUpFolder || !effectivePid) return;
                            setQuery({ pid: effectivePid, fid: parentFolderId ?? rootFid, q: null, sel: null });
                          }}
                          disabled={!canGoUpFolder}
                          title={canGoUpFolder ? "返回上一级" : "当前已在根目录"}
                          style={{ padding: "4px 10px" }}
                        >
                          返回上一级
                        </button>
                        <button
                          type="button"
                          className="mr-breadcrumb-link"
                          onClick={() => {
                            if (!rootFid || !effectivePid) return;
                            setQuery({ pid: effectivePid, fid: rootFid, scope: null, q: null, sel: null });
                          }}
                        >
                          根目录
                        </button>
                        {crumbs.map((c) => (
                          <span key={c.id} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                            <span aria-hidden="true">/</span>
                            <button
                              type="button"
                              className="mr-breadcrumb-link"
                              onClick={() => setQuery({ fid: c.id, q: null, sel: null })}
                            >
                              {c.name}
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ opacity: 0.7, fontSize: 12, fontFamily: "var(--font-mono), ui-monospace" }}>
                    {formatViewLabel(view)} · {formatSortLabel(sort)}
                  </div>
                </div>

                <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div className="mr-toolbar-group">
                    {scope === "trash" ? (
                      <>
                        <button className="mr-btn" type="button" onClick={() => setQuery({ scope: null, sel: null, q: null })}>
                          返回项目
                        </button>
                        <button
                          className="mr-btn mr-btn--danger"
                          type="button"
                          onClick={() => currentProject && openClearTrashDialog(currentProject.id, currentProject.name)}
                          disabled={trashItems.length === 0 || busy || !canEditAssets}
                        >
                          全部删除
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="mr-btn mr-btn--primary" type="button" onClick={() => openUploadDialog()} disabled={!canEditAssets}>
                          上传视频
                        </button>
                        <button className="mr-btn" type="button" onClick={() => openCreateFolderDialog()} disabled={!canEditAssets}>
                          新建文件夹
                        </button>
                        <button className="mr-btn" type="button" onClick={() => setQuery({ scope: "trash", sel: null, q: null })}>
                          回收站 ({trashItems.length})
                        </button>
                      </>
                    )}
                  </div>
                  <div className="mr-toolbar-group">
                    {scope === "workspace" ? (
                      <>
                        <button className="mr-btn" type="button" onClick={() => {
                          if (selectionMode) {
                            clearSelection();
                            setQuery({ select: "0" });
                          } else {
                            setQuery({ select: "1" });
                          }
                        }}>
                          {selectionMode ? `退出多选 (${selectedIds.size})` : "多选"}
                        </button>
                        <button className="mr-btn" type="button" onClick={() => openRenameDialog()} disabled={renameDisabled} title={renameHint}>
                          重命名
                        </button>
                        <button className="mr-btn mr-btn--danger" type="button" onClick={() => void onDeleteSelected()} disabled={!selectionMode || selectedIds.size === 0 || !canEditAssets}>
                          删除
                        </button>
                      </>
                    ) : null}
                  </div>
                  <div className="mr-toolbar-group">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--border2)", borderRadius: 999, padding: "8px 12px", background: "var(--surface-1)", minWidth: 260 }}>
                      <IconSearch size={16} />
                      <input
                        aria-label="搜索"
                        placeholder={scope === "trash" ? "搜索回收站…" : "搜索当前项目…"}
                        value={q}
                        onChange={(e) => setQuery({ q: e.target.value })}
                        style={{ border: 0, outline: "none", background: "transparent", color: "var(--text)", width: "100%" }}
                      />
                    </div>
                    <button className="mr-btn" type="button" onClick={() => setQuery({ view: view === "grid" ? "list" : "grid" })}>
                      {view === "grid" ? "列表视图" : "网格视图"}
                    </button>
                    <div style={{ position: "relative" }}>
                      <button
                        className="mr-btn mr-btn--menu"
                        type="button"
                        aria-label="排序方式"
                        aria-expanded={sortMenuOpen}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSortMenuOpen((open) => !open);
                        }}
                      >
                        <IconSort size={16} />
                        <span>{formatSortLabel(sort)}</span>
                      </button>
                      {sortMenuOpen ? (
                        <div
                          className="mr-panel"
                          style={{
                            position: "absolute",
                            right: 0,
                            top: "calc(100% + 8px)",
                            width: 168,
                            padding: 8,
                            zIndex: 30,
                            boxShadow: "var(--shadow)"
                          }}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div style={{ display: "grid", gap: 4 }}>
                            {([
                              ["updated_desc", "最近更新"],
                              ["name_asc", "名称 A-Z"],
                              ["name_desc", "名称 Z-A"]
                            ] as const).map(([value, label]) => (
                              <button
                                key={value}
                                className={`mr-btn mr-btn--menu-item${sort === value ? " mr-btn--menu-item-active" : ""}`}
                                type="button"
                                onClick={() => {
                                  setQuery({ sort: value });
                                  setSortMenuOpen(false);
                                }}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                {scope === "workspace" && selectionMode ? (
                  <div className="mr-selection-bar">
                    <div>
                      <strong>批量模式已开启</strong>
                      <span style={{ marginLeft: 8, color: "var(--muted)" }}>当前已选择 {selectedIds.size} 项</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span className="mr-badge">可批量删除</span>
                      <span className="mr-badge">重命名仅支持单项</span>
                    </div>
                  </div>
                ) : null}

                {visibleItems.length === 0 ? (
                  <div className="mr-panel" style={{ marginTop: 18, padding: 18, boxShadow: "none", background: "var(--panel3)" }}>
                    <div style={{ fontWeight: 800 }}>{scope === "trash" ? "回收站还是空的" : "这里还是空的"}</div>
                    <div style={{ marginTop: 6, color: "var(--muted)", lineHeight: 1.6 }}>
                      {scope === "trash" ? "删除后的视频会显示在这里。" : "先创建文件夹，再把视频上传进去。现在默认没有任何预设文件夹。"}
                    </div>
                  </div>
                ) : view === "list" ? (
                  <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
                    {visibleItems.map((it) => {
                      const selected = selectedIds.has(it.id);
                      const deletedAt = "deletedAt" in it && typeof it.deletedAt === "number" ? it.deletedAt : null;
                      const isTrashVideo = scope === "trash" && it.kind === "video";
                      return (
                        <div
                          key={it.id}
                          className={`mr-panel mr-item-row${selected ? " mr-item-row--selected" : ""}`}
                          onContextMenu={(event) => openContextMenu(event, it)}
                        >
                          <button
                            type="button"
                            className="mr-item-row__surface"
                            onClick={() => {
                              void handleItemClick(it);
                            }}
                          >
                            {scope === "workspace" && selectionMode ? (
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleSelected(it.id)}
                                onClick={(event) => event.stopPropagation()}
                                aria-label="选择"
                              />
                            ) : null}

                            <div style={{ width: 26, opacity: 0.85 }}>
                              {it.kind === "folder" ? <IconFolder size={18} /> : <IconVideo size={18} />}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }} title={it.name}>
                              <div style={{ fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                              <div style={{ opacity: 0.65, fontSize: 12, marginTop: 4 }}>
                                {it.kind === "video"
                                  ? `${formatDuration(it.durationSeconds)} · ${formatBytes(it.sizeBytes)} · ${formatFrames(it)} · ${formatResolution(it)} · ${formatBitrate(it)}`
                                  : "文件夹"}
                              </div>
                              {isTrashVideo ? (
                                <div style={{ opacity: 0.6, fontSize: 12, marginTop: 4 }}>
                                  删除于 {deletedAt ? new Date(deletedAt).toLocaleString("zh-CN") : "-"}
                                </div>
                              ) : null}
                            </div>
                            <div style={{ width: 140, opacity: 0.65, fontSize: 12, textAlign: "right" }}>
                              {new Date(it.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </button>
                          <button
                            type="button"
                            className="mr-item-action mr-item-row__menu"
                            aria-label={`条目菜单：${it.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              const rect = event.currentTarget.getBoundingClientRect();
                              setContextMenu({ x: Math.max(12, rect.right - 180), y: Math.max(12, rect.bottom + 8), target: it });
                            }}
                          >
                            <span aria-hidden="true">⋯</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                    {visibleItems.map((it) => {
                      const selected = selectedIds.has(it.id);
                      const deletedAt = "deletedAt" in it && typeof it.deletedAt === "number" ? it.deletedAt : null;
                      const isTrashVideo = scope === "trash" && it.kind === "video";
                      return (
                        <div
                          key={it.id}
                          className={`mr-panel mr-card-button${selected ? " mr-card-button--selected" : ""}`}
                          onContextMenu={(event) => openContextMenu(event, it)}
                        >
                          <button
                            type="button"
                            className="mr-card-button__surface"
                            onClick={() => {
                              void handleItemClick(it);
                            }}
                          >
                            <div
                              className={`mr-card-button__preview${it.kind === "folder" ? " mr-card-button__preview--folder" : " mr-card-button__preview--video"}`}
                            >
                              {it.kind === "folder" ? <IconFolder size={22} /> : <VideoCardPreview name={it.name} previewUrl={previewUrls[it.id]} />}
                              {scope === "workspace" && selectionMode ? (
                                <span style={{ position: "absolute", top: 8, left: 8 }}>
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={() => toggleSelected(it.id)}
                                    onClick={(event) => event.stopPropagation()}
                                    aria-label="选择"
                                  />
                                </span>
                              ) : null}
                            </div>

                            <div className="mr-card-button__body">
                              <div className="mr-card-button__content" title={it.name}>
                                <div className="mr-card-button__title">
                                  {it.name}
                                </div>
                                <div className="mr-card-button__meta">
                                  {it.kind === "video" ? (
                                    <>
                                      <div>{formatBytes(it.sizeBytes)} · {formatDuration(it.durationSeconds)}</div>
                                      <div>{formatFrames(it)} · {formatResolution(it)}</div>
                                      <div>{formatBitrate(it)}</div>
                                      {isTrashVideo ? <div>删除于 {deletedAt ? new Date(deletedAt).toLocaleString("zh-CN") : "-"}</div> : null}
                                    </>
                                  ) : "文件夹"}
                                </div>
                              </div>
                            </div>
                          </button>
                          <button
                            type="button"
                            className="mr-item-action mr-item-action--overlay mr-card-button__menu"
                            aria-label={`条目菜单：${it.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              const rect = event.currentTarget.getBoundingClientRect();
                              setContextMenu({ x: Math.max(12, rect.right - 180), y: Math.max(12, rect.bottom + 8), target: it });
                            }}
                          >
                            <span aria-hidden="true">⋯</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {contextMenu ? (
                <div
                  className="mr-panel"
                  style={{
                    position: "fixed",
                    left: Math.max(12, contextMenu.x),
                    top: Math.max(12, contextMenu.y),
                    width: 200,
                    padding: 8,
                    zIndex: 40,
                    boxShadow: "var(--shadow)"
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div style={{ display: "grid", gap: 4 }}>
                    {contextMenu.target === "project_area" ? (
                      <button className="mr-btn" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("create_project")}>
                        新建项目
                      </button>
                    ) : contextMenu.target === "workspace" ? (
                      <button className="mr-btn" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("create_folder")}>
                        新建文件夹
                      </button>
                    ) : contextMenu.target.kind === "project" ? (
                      <>
                        <button className="mr-btn" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("open")}>
                          打开项目
                        </button>
                        <button className="mr-btn" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("rename")}>
                          重命名项目
                        </button>
                        <button className="mr-btn mr-btn--danger" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("delete")}>
                          删除项目
                        </button>
                      </>
                    ) : contextMenu.target.kind === "folder_tree" ? (
                      <>
                        <button className="mr-btn" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("open")}>
                          打开文件夹
                        </button>
                        <button className="mr-btn" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("rename")} disabled={!canEditAssets}>
                          重命名
                        </button>
                        <button className="mr-btn mr-btn--danger" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("delete")} disabled={!canEditAssets}>
                          删除
                        </button>
                      </>
                    ) : scope === "trash" ? (
                      <>
                        <button className="mr-btn" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("download")}>
                          下载
                        </button>
                        <button className="mr-btn" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("restore")}>
                          恢复
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="mr-btn" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("open")}>
                          {contextMenu.target.kind === "folder" ? "打开文件夹" : "打开预览"}
                        </button>
                        {contextMenu.target.kind === "video" ? (
                          <>
                            <button className="mr-btn" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("video_permissions")}>
                              视频权限
                            </button>
                            <button className="mr-btn" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("video_share_links")}>
                              分享链接
                            </button>
                            <button className="mr-btn" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("download")}>
                              下载
                            </button>
                          </>
                        ) : null}
                        <button className="mr-btn" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("rename")} disabled={!canEditAssets}>
                          重命名
                        </button>
                        <button className="mr-btn mr-btn--danger" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("delete")} disabled={!canEditAssets}>
                          删除
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </>
          }
          right={
            <div style={{ display: "grid", gap: 10 }}>
              <div className={`mr-inspector-panel${inspectorPaneOpen ? "" : " mr-inspector-panel--collapsed"}`}>
                <div className="mr-inspector-panel__head">
                  {inspectorPaneOpen ? <div className="mr-inspector-panel__title">项目信息</div> : null}
                  <button
                    className="mr-btn mr-btn--surface mr-inspector-toggle"
                    type="button"
                    title={inspectorPaneOpen ? "收起项目信息" : "展开项目信息"}
                    aria-label={inspectorPaneOpen ? "收起项目信息" : "展开项目信息"}
                    onClick={() => setQuery({ panel: inspectorPaneOpen ? "0" : "1" })}
                  >
                    <IconChevron size={18} dir={inspectorPaneOpen ? "right" : "left"} />
                  </button>
                </div>
                {inspectorPaneOpen ? (
                  currentProject ? (
                    <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                      <div>
                        <div style={{ fontWeight: 900 }}>{currentProject.name}</div>
                        <div style={{ marginTop: 4, color: "var(--muted)", fontSize: 13 }}>
                          {scope === "trash" ? "当前查看：回收站" : `当前目录：${currentFolderName}`}
                        </div>
                      </div>
                      <div className="mr-project-meta">
                        <span>拥有者</span>
                        <strong>{projectOwnerLabel}</strong>
                      </div>
                      <div className="mr-project-meta">
                        <span>创建时间</span>
                        <strong>{new Date(currentProject.createdAt).toLocaleString("zh-CN")}</strong>
                      </div>
                      <div className="mr-project-meta">
                        <span>更新时间</span>
                        <strong>{new Date(currentProject.updatedAt).toLocaleString("zh-CN")}</strong>
                      </div>
                      <div className="mr-project-meta">
                        <span>当前条目</span>
                        <strong>{visibleItems.length}</strong>
                      </div>
                      <div className="mr-project-meta">
                        <span>当前视图大小</span>
                        <strong>{formatBytes(projectViewSizeBytes)}</strong>
                      </div>
                      <div className="mr-project-meta">
                        <span>我的权限</span>
                        <strong>{roleLabel(currentProject.role)}</strong>
                      </div>
                      {canProject(currentProject, "project:manage_members") ? (
                        <button className="mr-btn mr-btn--primary" type="button" onClick={() => openCollaborationDialog(currentProject)}>
                          协作成员
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>选择一个项目后，这里会显示项目级信息。</div>
                  )
                ) : null}
              </div>
              {preferences.showUploadQueue ? (
                <UploadPanel
                  uploads={uploads}
                  onClear={() => clearUploadHistory()}
                  onOpenItem={(mediaId) => void openUploadItem(mediaId)}
                  onCancelItem={(uploadId) => cancelUpload(uploadId)}
                  defaultCollapsed
                />
              ) : null}
            </div>
          }
        />
      )}
    </main>
  );
}
