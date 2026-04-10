"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  IconFolder,
  IconInfo,
  IconMoon,
  IconSettings,
  IconSun
} from "./icons";
import { useTheme } from "./theme";

export type ApiUser = { id: string; username: string; displayName: string | null };
export type Project = { id: string; name: string; ownerId: string; createdAt: string; updatedAt: string };

export type FolderNode = {
  id: string;
  name: string;
  children?: FolderNode[];
};

export type ViewMode = "grid" | "list";

export type SortMode = "updated_desc" | "name_asc" | "name_desc";

export type WorkspaceItem =
  | {
      id: string;
      kind: "folder";
      name: string;
      updatedAt: number;
    }
  | {
      id: string;
      kind: "video";
      name: string;
      updatedAt: number;
      durationSeconds?: number;
      sizeBytes?: number;
      width?: number;
      height?: number;
      frameCount?: number;
      bitrateKbps?: number;
      status?: string;
    };

export type UploadStage = "preparing" | "signing" | "uploading" | "processing" | "ready" | "error";

export type UploadItem = {
  id: string;
  fileName: string;
  progress: number;
  stage: UploadStage;
  error?: string;
  mediaId?: string;
  actionLabel?: string;
};

type Props = {
  user: ApiUser;
  inspectorOpen: boolean;
  onClearUploads: () => void;
  onOpenUploadItem: (mediaId: string) => void;
  onLocateUploadItem: (mediaId: string) => void;
  onLogout: () => void;

  onGoProjectHome: () => void;
  onGoSettings: () => void;
  onGoAbout: () => void;

  uploads?: UploadItem[];
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
};

function Avatar({ name }: { name: string }) {
  const initial = (name.trim()[0] ?? "U").toUpperCase();
  return <div className="mr-shell__avatar" aria-label="用户">{initial}</div>;
}

function PrimaryNav({
  onGoProjectHome,
  onGoSettings,
  onGoAbout
}: {
  onGoProjectHome: () => void;
  onGoSettings: () => void;
  onGoAbout: () => void;
}) {
  const { theme, toggle } = useTheme();

  function NavButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
    return (
      <button className="mr-btn mr-shell__nav-button" onClick={onClick} title={title} type="button">
        {children}
      </button>
    );
  }

  return (
    <aside className="mr-shell__nav">
      <div className="mr-shell__brand" title="MarkReel">
        MR
      </div>

      <div className="mr-shell__nav-group">
        <NavButton title="项目首页" onClick={onGoProjectHome}>
          <IconFolder size={20} />
        </NavButton>
        <NavButton title="设置" onClick={onGoSettings}>
          <IconSettings size={20} />
        </NavButton>
        <NavButton title="关于" onClick={onGoAbout}>
          <IconInfo size={20} />
        </NavButton>
      </div>

      <div className="mr-shell__nav-spacer" />

      <NavButton title="深浅色切换" onClick={() => toggle()}>
        {theme === "dark" ? <IconSun size={20} /> : <IconMoon size={20} />}
      </NavButton>
    </aside>
  );
}

function UploadStageLabel({ stage }: { stage: UploadItem["stage"] }) {
  const label: Record<UploadItem["stage"], string> = {
    preparing: "准备中",
    signing: "获取上传地址",
    uploading: "上传中",
    processing: "已上传，生成预览中",
    ready: "可以预览",
    error: "失败"
  };
  return <span>{label[stage]}</span>;
}

function UploadPanel({
  uploads,
  onClear,
  onOpenItem,
  onLocateItem
}: {
  uploads: UploadItem[];
  onClear: () => void;
  onOpenItem: (mediaId: string) => void;
  onLocateItem: (mediaId: string) => void;
}) {
  const activeCount = useMemo(() => uploads.filter((item) => item.stage !== "ready" && item.stage !== "error").length, [uploads]);

  if (uploads.length === 0) return null;

  return (
    <div className="mr-shell__uploads">
      <div className="mr-panel mr-shell__uploads-card">
        <div className="mr-shell__uploads-head">
          <div>
            <div className="mr-shell__uploads-title">Upload queue</div>
            <div className="mr-shell__uploads-subtitle">上传与处理进度</div>
          </div>
          <div className="mr-shell__uploads-actions">
            <span className="mr-badge mr-badge--accent">{uploads.length} 项任务</span>
            {activeCount > 0 ? <span className="mr-badge">{activeCount} 进行中</span> : null}
            <button className="mr-btn" type="button" onClick={onClear}>
              清空记录
            </button>
          </div>
        </div>

        <div className="mr-shell__upload-list">
          {uploads.map((item) => {
            const isReady = item.stage === "ready";
            const isError = item.stage === "error";
            return (
              <div
                key={item.id}
                className={`mr-shell__upload-item${isReady ? " mr-shell__upload-item--ready" : ""}${isError ? " mr-shell__upload-item--error" : ""}`}
              >
                <div className="mr-shell__upload-row">
                  <div className="mr-shell__upload-main">
                    <div className="mr-shell__upload-name">{item.fileName}</div>
                    <div className="mr-shell__upload-meta">
                      <UploadStageLabel stage={item.stage} />
                      <span style={{ opacity: 0.45 }}>•</span>
                      <span>{Math.max(0, Math.min(100, item.progress))}%</span>
                      {item.actionLabel ? (
                        <>
                          <span style={{ opacity: 0.45 }}>•</span>
                          <span>{item.actionLabel}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <span className={`mr-badge${isReady ? " mr-badge--accent" : ""}`}>{isError ? "异常" : isReady ? "可用" : "处理中"}</span>
                </div>

                <div className="mr-progress" style={{ marginTop: 10 }}>
                  <div className="mr-progress__bar" style={{ width: `${Math.max(4, item.progress)}%` }} />
                </div>

                {item.error ? <div className="mr-shell__upload-error">{item.error}</div> : null}
                {item.mediaId ? (
                  <div className="mr-shell__upload-actions">
                    {isReady ? (
                      <button className="mr-btn mr-btn--primary" type="button" onClick={() => onOpenItem(item.mediaId!)}>
                        打开预览
                      </button>
                    ) : null}
                    <button className="mr-btn" type="button" onClick={() => onLocateItem(item.mediaId!)}>
                      定位素材
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Topbar({
  title,
  userName,
  onLogout,
  onGoSettings
}: {
  title: string;
  userName: string;
  onLogout: () => void;
  onGoSettings: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-mr-menu]")) return;
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <header className="mr-shell__topbar">
      <div className="mr-panel mr-shell__topbar-card">
        <div className="mr-shell__topbar-row">
          <div className="mr-shell__title-wrap">
            <div className="mr-shell__kicker">Workbench</div>
            <div className="mr-shell__title">{title}</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" onClick={() => setMenuOpen((s) => !s)} className="mr-shell__user-button" title="用户">
              <Avatar name={userName} />
            </button>
          </div>
        </div>

        {menuOpen ? (
          <div className="mr-panel mr-shell__menu" data-mr-menu>
            <div className="mr-shell__menu-label">当前用户</div>
            <div className="mr-shell__menu-name">{userName}</div>
            <div className="mr-shell__menu-actions">
              <button className="mr-btn" style={{ width: "100%" }} onClick={onGoSettings}>
                用户设置
              </button>
              <button className="mr-btn mr-btn--danger" style={{ width: "100%" }} onClick={onLogout}>
                退出登录
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}

export function AppShell(props: Props) {
  return (
    <div className="mr-shell">
      <PrimaryNav onGoProjectHome={props.onGoProjectHome} onGoSettings={props.onGoSettings} onGoAbout={props.onGoAbout} />

      <main className="mr-shell__main">
        <Topbar
          title="项目工作台"
          userName={props.user.displayName ?? props.user.username}
          onLogout={props.onLogout}
          onGoSettings={props.onGoSettings}
        />

        <UploadPanel
          uploads={props.uploads ?? []}
          onClear={props.onClearUploads}
          onOpenItem={props.onOpenUploadItem}
          onLocateItem={props.onLocateUploadItem}
        />

        <div className="mr-shell__body">
          <aside className="mr-shell__sidebar">{props.left}</aside>
          <section className="mr-shell__center">{props.center}</section>
          <aside className={`mr-shell__inspector${props.inspectorOpen ? "" : " mr-shell__inspector--collapsed"}`}>{props.right}</aside>
        </div>
      </main>
    </div>
  );
}
