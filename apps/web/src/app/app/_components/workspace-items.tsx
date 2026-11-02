"use client";

import type { MouseEvent } from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { IconChevron, IconFolder, IconMore, IconVideo } from "./icons";
import type { ViewMode, WorkspaceItem } from "./shell";
import { formatBytes, formatDuration } from "./workspaceMock";
import { WORKSPACE_PAGE_SIZE, workspacePage } from "./workspace-items-model";

type Props = {
  items: WorkspaceItem[];
  view: ViewMode;
  scope: "workspace" | "trash";
  selectedIds: Set<string>;
  selectionMode: boolean;
  filterKey: string;
  onOpen: (item: WorkspaceItem) => void;
  onSelect: (id: string) => void;
  onContextMenu: (event: MouseEvent, item: WorkspaceItem) => void;
  onMenu: (event: MouseEvent<HTMLButtonElement>, item: WorkspaceItem) => void;
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

function videoDetails(item: Extract<WorkspaceItem, { kind: "video" }>) {
  const fps = item.frameCount && item.durationSeconds ? item.frameCount / item.durationSeconds : null;
  return {
    frames: fps && Number.isFinite(fps) ? `${Number(fps.toFixed(2))} FPS` : "FPS 未知",
    resolution: item.width && item.height ? `${item.width}×${item.height}` : "分辨率未知",
    bitrate: item.bitrateKbps ? `${item.bitrateKbps} kbps` : "码率未知"
  };
}

function VideoThumbnail({ item }: { item: Extract<WorkspaceItem, { kind: "video" }> }) {
  const host = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState(item.thumbnailUrl ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (item.thumbnailUrl || !host.current) return;
    let current = true;
    const controller = new AbortController();
    async function load() {
      try {
        const result = await api<{ thumbnail: { url: string } }>(`/media/${item.id}/thumbnail`, { signal: controller.signal });
        if (current) setUrl(result.thumbnail.url);
      } catch {
        // Missing thumbnails retain the media placeholder, not a page-level error.
      }
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void load();
    }, { rootMargin: "160px" });
    observer.observe(host.current);
    return () => {
      current = false;
      controller.abort();
      observer.disconnect();
    };
  }, [item.id, item.thumbnailUrl]);

  return <div ref={host} className="mr-workspace-items__thumbnail">
    {url && !failed ? <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} /> : <IconVideo size={26} />}
  </div>;
}

const WorkspaceRow = memo(function WorkspaceRow({ item, view, selected, selectionMode, scope, onOpen, onSelect, onContextMenu, onMenu }: Omit<Props, "items" | "selectedIds" | "filterKey"> & { item: WorkspaceItem; selected: boolean }) {
  const details = item.kind === "video" ? videoDetails(item) : null;
  const deletedAt = "deletedAt" in item && typeof item.deletedAt === "number" ? item.deletedAt : null;
  const isTrashVideo = scope === "trash" && item.kind === "video";
  const checkbox = scope === "workspace" && selectionMode ? <input
    className="mr-workspace-items__checkbox" type="checkbox" checked={selected}
    onChange={() => onSelect(item.id)} aria-label={`选择：${item.name}`}
  /> : null;

  return <div
    className={`mr-panel ${view === "list" ? "mr-item-row" : "mr-card-button"}${selected ? view === "list" ? " mr-item-row--selected" : " mr-card-button--selected" : ""}`}
    onContextMenu={(event) => onContextMenu(event, item)} data-workspace-item={item.id}
  >
    {checkbox}
    <button type="button" className={view === "list" ? "mr-item-row__surface" : "mr-card-button__surface"} onClick={() => onOpen(item)}>
      {view === "list" ? <>
        <div style={{ width: 26, flexShrink: 0, opacity: 0.85 }}>{item.kind === "folder" ? <IconFolder size={18} /> : <IconVideo size={18} />}</div>
        <div className="mr-workspace-items__list-name" title={item.name}>
          <div className="mr-workspace-items__name">{item.name}{item.kind === "video" && (item.versionCount ?? 1) > 1 ? <span className="mr-workspace-items__versions">V{item.versionIndex ?? 1} · {item.versionCount} 个版本</span> : null}</div>
          <div className="mr-workspace-items__meta">{details && item.kind === "video" ? `${formatDuration(item.durationSeconds)} · ${formatBytes(item.sizeBytes)} · ${details.frames} · ${details.resolution} · ${details.bitrate}` : "文件夹"}</div>
          {isTrashVideo ? <div className="mr-workspace-items__meta">删除于 {deletedAt ? new Date(deletedAt).toLocaleString("zh-CN") : "-"}</div> : null}
        </div>
        <time className="mr-workspace-items__updated">{dateFormatter.format(item.updatedAt)}</time>
      </> : <>
        <div className={`mr-card-button__preview${item.kind === "folder" ? " mr-card-button__preview--folder" : " mr-card-button__preview--video"}`}>
          {item.kind === "folder" ? <IconFolder size={22} /> : <VideoThumbnail item={item} />}
        </div>
        <div className="mr-card-button__body">
          <div className="mr-card-button__content" title={item.name}>
            <div className="mr-card-button__title">{item.name}</div>
            {item.kind === "video" && (item.versionCount ?? 1) > 1 ? <div className="mr-workspace-items__versions">V{item.versionIndex ?? 1} · {item.versionCount} 个版本</div> : null}
            <div className="mr-card-button__meta">{details && item.kind === "video" ? <>
              <div>{formatBytes(item.sizeBytes)} · {formatDuration(item.durationSeconds)}</div>
              <div>{details.frames} · {details.resolution}</div>
              <div>{details.bitrate}</div>
              {isTrashVideo ? <div>删除于 {deletedAt ? new Date(deletedAt).toLocaleString("zh-CN") : "-"}</div> : null}
            </> : "文件夹"}</div>
          </div>
        </div>
      </>}
    </button>
    <button type="button" className={`mr-item-action ${view === "list" ? "mr-item-row__menu" : "mr-item-action--overlay mr-card-button__menu"}`} aria-label={`条目菜单：${item.name}`} onClick={(event) => onMenu(event, item)}>
      <IconMore />
    </button>
  </div>;
});

export const WorkspaceItems = memo(function WorkspaceItems(props: Props) {
  const [pageState, setPageState] = useState({ filterKey: props.filterKey, page: 0 });
  const requestedPage = pageState.filterKey === props.filterKey ? pageState.page : 0;
  const { page, pages, items } = useMemo(() => workspacePage(props.items, requestedPage), [props.items, requestedPage]);
  function goToPage(next: number) {
    setPageState({ filterKey: props.filterKey, page: next });
  }

  return <div className="mr-workspace-items">
    {pages > 1 ? <nav className="mr-workspace-items__pagination" aria-label="素材分页">
      <span>{page * WORKSPACE_PAGE_SIZE + 1} 至 {Math.min((page + 1) * WORKSPACE_PAGE_SIZE, props.items.length)} / {props.items.length}</span>
      <div>
        <button type="button" className="mr-btn" disabled={page === 0} title="上一页" aria-label="上一页" onClick={() => goToPage(page - 1)}><IconChevron size={18} dir="left" /></button>
        <span aria-live="polite">{page + 1} / {pages}</span>
        <button type="button" className="mr-btn" disabled={page === pages - 1} title="下一页" aria-label="下一页" onClick={() => goToPage(page + 1)}><IconChevron size={18} dir="right" /></button>
      </div>
    </nav> : null}
    <div className={`mr-workspace-items__${props.view}`}>
      {items.map((item) => <WorkspaceRow key={item.id} item={item} view={props.view} scope={props.scope} selected={props.selectedIds.has(item.id)} selectionMode={props.selectionMode} onOpen={props.onOpen} onSelect={props.onSelect} onContextMenu={props.onContextMenu} onMenu={props.onMenu} />)}
    </div>
  </div>;
});
