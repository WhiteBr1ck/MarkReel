"use client";

import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "./_components/shell";
import type { FolderNode, Project, SortMode, UploadItem, UploadStage, ViewMode, WorkspaceItem } from "./_components/shell";
import { Dialog, NameDialog } from "./_components/dialog";
import { formatBytes, formatDuration } from "./_components/workspaceMock";
import { IconFolder, IconSearch, IconSort, IconVideo } from "./_components/icons";

const APP_VERSION = "0.1.1";

type ApiUser = { id: string; username: string; displayName: string | null };
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

type AnnotationListResponse = {
  annotations: AnnotationRecord[];
};

type AttachmentPresignResponse = {
  upload: {
    method: "PUT";
    url: string;
    objectKey: string;
    bucket: string;
  };
};

type FeedbackTone = "info" | "success" | "error";

type FeedbackState = {
  tone: FeedbackTone;
  message: string;
};

type OverlayState = "settings" | "about" | null;

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

function uploadToPresignedUrl(url: string, file: File, onProgress?: (progress: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const progress = Math.round((event.loaded / event.total) * 100);
      onProgress?.(progress);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }
      reject(new Error(`upload_failed:${xhr.status}`));
    };

    xhr.onerror = () => reject(new Error("upload_failed:network"));
    xhr.send(file);
  });
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
    database_unavailable: "数据库不可用，请先启动 API 的 SQLite/Prisma 链路",
    internal_server_error: "服务器内部错误（请查看 API 控制台日志）"
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

function formatFrames(item: Extract<WorkspaceItem, { kind: "video" }>) {
  if (!item.frameCount) return "帧数未知";
  return `${item.frameCount} 帧`;
}

function formatBitrate(item: Extract<WorkspaceItem, { kind: "video" }>) {
  if (!item.bitrateKbps) return "码率未知";
  return `${item.bitrateKbps} kbps`;
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
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [previewBusy, setPreviewBusy] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [overlay, setOverlay] = useState<OverlayState>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [projectOrder, setProjectOrder] = useState<string[]>([]);
  const [dragProjectId, setDragProjectId] = useState<string | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);

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
  const inspectorPaneOpen = (sp.get("panel") ?? sp.get("inspector") ?? "1") !== "0";
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
      setUser(null);
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
    try {
      await api<PreviewResponse>(`/media/${mediaId}/preview`);
      setUploadReady(id, mediaId);
    } catch (e: any) {
      if (e?.data?.error === "preview_not_ready") {
        updateUpload(id, {
          stage: "processing",
          progress: 98,
          mediaId,
          actionLabel: "预览生成中"
        });
        return false;
      }
      throw e;
    }
    return true;
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
    await api("/auth/logout", { method: "POST", body: "{}" });
    setUser(null);
    setWorkspaces([]);
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
    setUploads((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
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
      setUploads((prev) => prev.map((upload) => (upload.mediaId === item.id ? { ...upload, stage: "ready", progress: 100, error: undefined, actionLabel: "可预览" } : upload)));
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
      setUploads((prev) => prev.map((upload) => (upload.mediaId === mediaId ? { ...upload, stage: "ready", progress: 100, error: undefined, actionLabel: "可预览" } : upload)));
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
    await uploadToPresignedUrl(data.upload.url, file);
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

  async function locateUploadItem(mediaId: string) {
    const current = workspace?.items.find((item) => item.id === mediaId) ?? null;
    const refreshed = current ? workspace : await refreshWorkspace(effectivePid, effectiveFid);
    const resolved = refreshed?.items.find((item) => item.id === mediaId) ?? current;
    if (!resolved) {
      showFeedback("info", "素材已上传，当前目录里还没看到它，稍后会自动刷新出来。");
      return;
    }

    setQuery({ select: "1", sel: resolved.id, panel: "1" });
    showFeedback("success", `已定位 ${resolved.name}`);
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

  function handleContextMenuAction(action: "create_folder" | "rename" | "delete" | "open" | "download" | "restore" | "create_project") {
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

    if (action === "restore" && scope === "trash" && target.kind === "video") {
      void onRestoreItem(target as TrashItem);
      return;
    }

    void openItem(target);
  }

  function clearUploadHistory() {
    setUploads([]);
    showFeedback("success", "已清空上传记录");
  }

  async function onUpload(files: File[]) {
    if (!effectivePid) return;
    setErr(null);
    setBusy(true);
    showFeedback("info", `已加入 ${files.length} 个上传任务`);

    const queued = files.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      fileName: file.name,
      progress: 2,
      stage: "preparing" as UploadStage,
      actionLabel: "排队中"
    }));
    setUploads((prev) => [...queued, ...prev].slice(0, 12));

    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i]!;
        const uploadId = queued[i]!.id;
        updateUpload(uploadId, { stage: "preparing", progress: 5, actionLabel: "准备上传" });

        const created = await api<{ media: { id: string } }>(`/projects/${effectivePid}/media`, {
          method: "POST",
          body: JSON.stringify({
            title: file.name,
            folderId: effectiveFid === rootFid ? null : effectiveFid
          })
        });

        updateUpload(uploadId, { mediaId: created.media.id, stage: "signing", progress: 12, actionLabel: "获取上传地址" });

        const presigned = await api<{ upload: { url: string; objectKey: string; mode: "original" | "compress" } }>(
          `/media/${created.media.id}/upload/presign`,
          {
            method: "POST",
            body: JSON.stringify({
              filename: file.name,
              contentType: file.type || "application/octet-stream",
              mode: "compress"
            })
          }
        );

        updateUpload(uploadId, { stage: "uploading", progress: 18, actionLabel: "正在上传文件" });
        await uploadToPresignedUrl(presigned.upload.url, file, (progress) => {
          updateUpload(uploadId, { stage: "uploading", progress: Math.max(18, progress), actionLabel: "正在上传文件" });
        });

        updateUpload(uploadId, { stage: "processing", progress: 96, actionLabel: "已上传，正在生成预览" });
        await api(`/media/${created.media.id}/process`, {
          method: "POST",
          body: JSON.stringify({
            mode: presigned.upload.mode,
            originalObjectKey: presigned.upload.objectKey
          })
        });

        await markUploadReady(uploadId, created.media.id);
      }

      await refreshWorkspace(effectivePid, effectiveFid);
      showFeedback("success", "上传请求已完成，正在为新素材刷新工作台");
    } catch (e: any) {
      let message = toZhError(e);
      if (typeof e?.message === "string" && e.message.startsWith("upload_failed:")) {
        const detail = e.message.slice("upload_failed:".length);
        if (detail === "network") {
          message = "上传文件失败：浏览器无法直连对象存储，请确认 MinIO 正在运行且已允许 http://localhost:5090 跨域上传";
        } else {
          message = `上传文件失败：对象存储返回 ${detail}`;
        }
      }
      setErr(message);
      showFeedback("error", message);
      const failed = queued.find((item) => item.stage !== "error");
      if (failed) setUploadError(failed.id, message);
    } finally {
      setBusy(false);
    }
  }


  const items: WorkspaceItem[] = useMemo(() => sortItems(filterItems(workspace?.items ?? [], q), sort), [workspace, q, sort]);
  const filteredTrashItems = useMemo(() => sortItems(filterItems(trashItems, q), sort), [trashItems, q, sort]);
  const visibleItems = scope === "trash" ? filteredTrashItems : items;
  const crumbs = workspace?.breadcrumbs ?? [];

  useEffect(() => {
    const visibleVideos = items.slice(0, view === "grid" ? 8 : 4);
    void warmPreviewUrls(visibleVideos);
  }, [items, view]);

  const folderTree = workspace?.folderTree ?? null;
  const currentFolderName = crumbs.at(-1)?.name ?? "根目录";
  const parentFolderId = crumbs.length > 1 ? crumbs[crumbs.length - 2]?.id ?? rootFid : rootFid;
  const canGoUpFolder = scope === "workspace" && effectivePid != null && effectiveFid != null && effectiveFid !== rootFid;
  const renameState = getRenameTarget();
  const renameDisabled = !workspace || !selectionMode || "error" in renameState;
  const renameHint = renameDisabled ? ("error" in renameState ? renameState.error : "请先进入多选模式") : "重命名当前选中条目";
  const currentProject = workspaces.find((project) => project.id === effectivePid) ?? workspace?.project ?? null;
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
        open={overlay === "settings"}
        title="设置"
        description="调整当前工作台的主题与界面偏好。"
        onClose={() => setOverlay(null)}
      >
        <div style={{ display: "grid", gap: 14 }}>
          <div className="mr-panel" style={{ padding: 14, boxShadow: "none", background: "var(--panel3)" }}>
            <div style={{ fontWeight: 800 }}>界面主题</div>
            <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
              深浅色切换按钮仍保留在左侧导航底部，这里主要作为集中入口，后续可以继续放工作台偏好项。
            </div>
          </div>
              {user ? (
                <div className="mr-panel" style={{ padding: 14, boxShadow: "none", background: "var(--panel3)" }}>
                  <div style={{ fontWeight: 800 }}>当前账号</div>
                  <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>
                    {user.displayName ?? user.username}
                  </div>
                </div>
              ) : null}
        </div>
      </Dialog>

      <Dialog
        open={overlay === "about"}
        title="关于 MarkReel"
        description="本地优先的视频审阅工作台。"
        onClose={() => setOverlay(null)}
      >
        <div style={{ display: "grid", gap: 12, lineHeight: 1.7, color: "var(--muted)" }}>
          <div>
            <strong style={{ color: "var(--text)" }}>版本</strong>
            <div style={{ marginTop: 4 }}>MarkReel {APP_VERSION}</div>
          </div>
          <div>
            MarkReel 是一个开源、自托管的视频审阅与标注工具，当前优先把上传、预览、逐帧查看和批注主路径做顺。
          </div>
          <div>
            现在这套工作台已经切到真实账号、真实本地持久化和真实上传链路，后续继续围绕交互和媒体能力细化。
          </div>
        </div>
      </Dialog>

      {!user ? (
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <div className="mr-panel" style={{ width: "min(980px, 100%)", padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <h1 style={{ margin: 0, fontSize: 28, letterSpacing: -0.6 }}>MarkReel</h1>
              <div style={{ opacity: 0.8, fontSize: 13, fontFamily: "var(--font-mono), ui-monospace" }}>
                API: /api (proxied)
              </div>
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="mr-btn" type="button" onClick={() => setMode("login")}>
                  登录
                </button>
                <button className="mr-btn" type="button" onClick={() => setMode("register")}>
                  注册
                </button>
              </div>

              <div style={{ opacity: 0.85, fontSize: 13, lineHeight: 1.5 }}>
                首次使用：先点“注册”，用用户名 + 密码创建账号；之后用同一用户名密码登录。当前为本地 SQLite 开发模式，数据会持久保存在项目本地数据库中。
              </div>

              {err ? <div className="mr-feedback mr-feedback--error">{err}</div> : null}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button className="mr-btn" type="button" onClick={() => void onAuth()}>
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
          onLocateUploadItem={(mediaId) => void locateUploadItem(mediaId)}
          onLogout={() => void onLogout()}
          onGoProjectHome={() => {
            if (!effectivePid) return;
            setQuery({ pid: effectivePid, fid: `root-${effectivePid}`, scope: null, q: null, sel: null });
          }}
          onGoSettings={() => setOverlay("settings")}
          onGoAbout={() => setOverlay("about")}
          uploads={uploads}
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
                          disabled={trashItems.length === 0 || busy}
                        >
                          全部删除
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="mr-btn mr-btn--primary" type="button" onClick={() => document.getElementById("mr-upload-input")?.click()}>
                          上传视频
                        </button>
                        <button className="mr-btn" type="button" onClick={() => openCreateFolderDialog()}>
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
                        <button className="mr-btn mr-btn--danger" type="button" onClick={() => void onDeleteSelected()} disabled={!selectionMode || selectedIds.size === 0}>
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
                  <input
                    id="mr-upload-input"
                    type="file"
                    accept="video/*"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length === 0) return;
                      void onUpload(files);
                      e.currentTarget.value = "";
                    }}
                  />
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
                        <button className="mr-btn" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("rename")}>
                          重命名
                        </button>
                        <button className="mr-btn mr-btn--danger" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("delete")}>
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
                          <button className="mr-btn" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("download")}>
                            下载
                          </button>
                        ) : null}
                        <button className="mr-btn" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("rename")}>
                          重命名
                        </button>
                        <button className="mr-btn mr-btn--danger" type="button" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => handleContextMenuAction("delete")}>
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
                  <div style={{ fontSize: 12, opacity: 0.7 }}>项目信息</div>
                  <button
                    className="mr-btn mr-btn--surface mr-inspector-toggle"
                    type="button"
                    title={inspectorPaneOpen ? "收起项目信息" : "展开项目信息"}
                    aria-label={inspectorPaneOpen ? "收起项目信息" : "展开项目信息"}
                    onClick={() => setQuery({ panel: inspectorPaneOpen ? "0" : "1" })}
                  >
                    <span aria-hidden="true">ⓘ</span>
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
                        <span>回收站条目</span>
                        <strong>{trashItems.length}</strong>
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>选择一个项目后，这里会显示项目级信息。</div>
                  )
                ) : (
                  <div className="mr-inspector-panel__collapsed-note">点击图标查看项目信息</div>
                )}
              </div>

              {inspectorPaneOpen ? (
                <div className="mr-panel" style={{ padding: 12, boxShadow: "none" }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>当前状态</div>
                  <div style={{ marginTop: 8, opacity: 0.75, fontSize: 13, lineHeight: 1.5 }}>
                    {previewBusy
                      ? "正在获取视频预览地址…"
                      : busy
                        ? "正在同步项目内容与上传任务…"
                        : scope === "trash"
                          ? "回收站支持恢复与下载已删除视频。"
                          : selectionMode
                            ? "已进入批量选择模式；重命名仍只支持一次处理一个条目。"
                            : "当前已接入真实项目接口，支持项目管理、上传进度和视频预览。"}
                  </div>
                  {err && !feedback ? <div style={{ marginTop: 8, color: "var(--warn)", fontSize: 13 }}>{err}</div> : null}
                </div>
              ) : null}
            </div>
          }
        />
      )}
    </main>
  );
}
