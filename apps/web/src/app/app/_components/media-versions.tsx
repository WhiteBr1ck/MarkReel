"use client";

import { useEffect, useId, useState } from "react";
import { IconCheck, IconHistory, IconRefresh, IconTrash, IconUpload } from "@tabler/icons-react";
import { api } from "./api";

export type MediaVersion = {
  id: string;
  projectId: string;
  title: string;
  versionIndex: number;
  status: "uploaded" | "queued" | "processing" | "ready" | "failed";
  reviewStatus: string;
  createdAt: string;
  updatedAt: string;
  creator: { id: string; username: string; displayName: string | null } | null;
  available: boolean;
  canManage: boolean;
};

export type MediaVersionHistory = {
  seriesId: string | null;
  versions: MediaVersion[];
  canUploadVersion: boolean;
  canDeleteSeries: boolean;
};

export type MediaVersionsProps = {
  mediaId: string;
  currentMediaId?: string;
  onSelect: (mediaId: string) => void;
  onUploadVersion?: (sourceMediaId: string) => void;
  onDeleted?: (mediaId: string) => void;
  refreshKey?: string | number;
  className?: string;
};

const statuses: Record<MediaVersion["status"], string> = {
  uploaded: "等待上传完成", queued: "排队中", processing: "处理中", ready: "可播放", failed: "处理失败"
};

function uploadDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" });
}

export function MediaVersions({ mediaId, currentMediaId = mediaId, onSelect, onUploadVersion, onDeleted, refreshKey, className }: MediaVersionsProps) {
  const headingId = useId();
  const [loaded, setLoaded] = useState<{ mediaId: string; history: MediaVersionHistory } | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const history = loaded?.mediaId === mediaId ? loaded.history : null;

  useEffect(() => {
    const controller = new AbortController();
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    setError(null);
    api<MediaVersionHistory>(`/media/${encodeURIComponent(mediaId)}/versions`, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setLoaded({ mediaId, history: data });
        if (data.versions.some((version) => version.status === "processing" || version.status === "queued" || version.status === "uploaded")) {
          refreshTimer = setTimeout(() => setRevision((value) => value + 1), 5000);
        }
      })
      .catch(() => { if (!controller.signal.aborted) setError("无法加载版本历史，请重试。"); });
    return () => { controller.abort(); clearTimeout(refreshTimer); };
  }, [mediaId, refreshKey, revision]);

  useEffect(() => { setConfirmDelete(null); }, [mediaId]);

  async function removeVersion(versionId: string) {
    if (deleting) return;
    setDeleting(versionId);
    setError(null);
    try {
      await api(`/media/${encodeURIComponent(versionId)}`, { method: "DELETE" });
      setLoaded((previous) => previous?.mediaId === mediaId ? { ...previous, history: { ...previous.history, versions: previous.history.versions.filter((version) => version.id !== versionId) } } : previous);
      setConfirmDelete(null);
      onDeleted?.(versionId);
      if (versionId !== mediaId) setRevision((value) => value + 1);
    } catch {
      setError("删除失败，该版本仍然保留。请重试。");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <section className={className} aria-labelledby={headingId} style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, paddingBlock: 12 }}>
        <h3 id={headingId} style={{ display: "flex", alignItems: "center", gap: 6, margin: 0, fontSize: 14, fontWeight: 600, flex: "1 1 auto" }}>
          <IconHistory size={18} aria-hidden="true" />版本历史
        </h3>
        <button type="button" className="mr-btn mr-btn--ghost" aria-label="刷新版本历史" title="刷新版本历史" disabled={Boolean(deleting)} onClick={() => setRevision((value) => value + 1)} style={{ width: 36, minHeight: 36, padding: 6 }}>
          <IconRefresh size={18} aria-hidden="true" />
        </button>
        {onUploadVersion && history?.canUploadVersion ? (
          <button type="button" className="mr-btn" onClick={() => onUploadVersion(mediaId)} disabled={Boolean(deleting)} style={{ minHeight: 36, borderRadius: 6 }}>
            <IconUpload size={16} aria-hidden="true" />上传新版本
          </button>
        ) : null}
      </div>
      <p role="status" style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>{!history && !error ? "加载版本历史中..." : history?.versions.length === 0 ? "暂无可访问的版本。" : ""}</p>
      {error ? <div role="alert" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, paddingBlock: 8 }}><span>{error}</span><button type="button" className="mr-btn mr-btn--ghost" onClick={() => setRevision((value) => value + 1)}>重试</button></div> : null}
      {history ? (
        <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {history.versions.map((version) => (
            <li key={version.id} style={{ paddingBlock: 10, borderTop: "1px solid var(--border)", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <button type="button" className="mr-btn mr-btn--ghost mr-media-versions__select" aria-current={version.id === currentMediaId ? "true" : undefined} onClick={() => onSelect(version.id)} disabled={Boolean(deleting)}>
                  <span style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>V{version.versionIndex}</span>
                  <span className="mr-media-versions__title">{version.title}</span>
                  {version.id === currentMediaId ? <IconCheck size={16} aria-label="当前版本" style={{ flexShrink: 0 }} /> : null}
                </button>
                {version.canManage ? (
                  <button type="button" className="mr-btn mr-btn--ghost" aria-label={`删除 V${version.versionIndex}`} title={`删除 V${version.versionIndex}`} onClick={() => setConfirmDelete(version.id)} disabled={Boolean(deleting)} style={{ width: 36, minHeight: 36, padding: 6, flexShrink: 0 }}>
                    <IconTrash size={16} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 4, fontSize: 12, color: "var(--muted)", overflowWrap: "anywhere" }}>
                <span>{version.available ? statuses.ready : version.status === "ready" ? "预览不可用" : statuses[version.status]}</span>
                <span>{version.creator?.displayName || version.creator?.username || "上传者未知"}</span>
                <time dateTime={version.createdAt}>{uploadDate(version.createdAt)}</time>
              </div>
              {confirmDelete === version.id ? (
                <div role="group" aria-label={`确认删除 V${version.versionIndex}`} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8 }}>
                  <span style={{ fontSize: 13 }}>仅将 V{version.versionIndex} 移入回收站？</span>
                  <button type="button" className="mr-btn" disabled={Boolean(deleting)} onClick={() => void removeVersion(version.id)}>{deleting === version.id ? "删除中..." : "确认删除"}</button>
                  <button type="button" className="mr-btn mr-btn--ghost" disabled={Boolean(deleting)} onClick={() => setConfirmDelete(null)}>取消</button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
