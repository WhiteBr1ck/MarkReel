"use client";

import AvatarSvg from "boring-avatars";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  IconAutoTheme,
  IconFolder,
  IconInfo,
  IconMoon,
  IconSettings,
  IconSun
} from "./icons";
import { type Theme, useTheme, useUiPreferences } from "./theme";

export type ApiUser = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl?: string | null;
  avatarPreset?: string | null;
  globalRole?: "admin" | "user";
};
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
  onGoUserSettings: () => void;
  onGoAdminSettings?: () => void;
  onGoAbout: () => void;

  uploads?: UploadItem[];
  showUploads?: boolean;
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
};

const AVATAR_COLORS = ["#27201c", "#c96442", "#e5b56d", "#6f7f68", "#f2eadb"];

function Avatar({ name, src, preset, label }: { name: string; src?: string | null; preset?: string | null; label: string }) {
  const avatarName = preset || name || "markreel";
  return src ? (
    <img className="mr-shell__avatar-image" src={src} alt={label} />
  ) : (
    <div className="mr-shell__avatar" aria-label={label}>
      <AvatarSvg name={avatarName} colors={AVATAR_COLORS} variant="beam" size={44} square />
    </div>
  );
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
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { labels } = useUiPreferences();
  const themeLabelMap: Record<Theme, string> = {
    dark: labels.common.dark,
    light: labels.common.light,
    system: labels.common.system
  };
  const nextTheme: Theme = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
  const themeLabel = themeLabelMap[theme];
  const resolvedThemeLabel = themeLabelMap[resolvedTheme];
  const themeTitle = theme === "system" ? `${themeLabel} (${resolvedThemeLabel})` : themeLabel;
  const themeIcon = theme === "dark" ? <IconMoon size={20} /> : theme === "light" ? <IconSun size={20} /> : <IconAutoTheme size={20} />;

  function NavButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
    return (
      <button className="mr-btn mr-shell__nav-button" onClick={onClick} title={title} aria-label={title} type="button">
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
        <NavButton title={labels.shell.navProjects} onClick={onGoProjectHome}>
          <IconFolder size={20} />
        </NavButton>
        <NavButton title={labels.shell.navSettings} onClick={onGoSettings}>
          <IconSettings size={20} />
        </NavButton>
        <NavButton title={labels.shell.navAbout} onClick={onGoAbout}>
          <IconInfo size={20} />
        </NavButton>
      </div>

      <div className="mr-shell__nav-spacer" />

      <div className="mr-shell__theme-control">
        <NavButton title={themeTitle} onClick={() => setTheme(nextTheme)}>
          <span className="mr-shell__theme-button-icon" aria-hidden="true">
            {themeIcon}
          </span>
        </NavButton>
      </div>
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
  const { labels } = useUiPreferences();
  const activeCount = useMemo(() => uploads.filter((item) => item.stage !== "ready" && item.stage !== "error").length, [uploads]);

  if (uploads.length === 0) return null;

  return (
    <div className="mr-shell__uploads">
      <div className="mr-panel mr-shell__uploads-card">
        <div className="mr-shell__uploads-head">
          <div>
            <div className="mr-shell__uploads-title">{labels.shell.uploadsKicker}</div>
            <div className="mr-shell__uploads-subtitle">{labels.shell.uploadsTitle}</div>
          </div>
          <div className="mr-shell__uploads-actions">
            <span className="mr-badge mr-badge--accent">{uploads.length} {labels.shell.uploadTasks}</span>
            {activeCount > 0 ? <span className="mr-badge">{activeCount} {labels.shell.uploadActive}</span> : null}
            <button className="mr-btn" type="button" onClick={onClear}>
              {labels.shell.clearUploads}
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
  user,
  onLogout,
  onGoUserSettings,
  onGoAdminSettings
}: {
  title: string;
  user: ApiUser;
  onLogout: () => void;
  onGoUserSettings: () => void;
  onGoAdminSettings?: () => void;
}) {
  const { labels } = useUiPreferences();
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

  const userName = user.displayName ?? user.username;
  const isAdmin = user.globalRole === "admin";

  return (
    <header className="mr-shell__topbar">
      <div className="mr-panel mr-shell__topbar-card">
        <div className="mr-shell__topbar-row">
          <div className="mr-shell__title-wrap">
            <div className="mr-shell__kicker">{labels.shell.topbarKicker}</div>
            <div className="mr-shell__title">{title}</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" onClick={() => setMenuOpen((s) => !s)} className="mr-shell__user-button" title={labels.shell.userAriaLabel}>
              <Avatar name={userName} src={user.avatarUrl} preset={user.avatarPreset} label={labels.shell.userAriaLabel} />
            </button>
          </div>
        </div>

        {menuOpen ? (
          <div className="mr-panel mr-shell__menu" data-mr-menu>
            <div className="mr-shell__menu-label">{labels.shell.userMenuLabel}</div>
            <div className="mr-shell__menu-name">{userName}</div>
            <div className="mr-shell__menu-actions">
              <button className="mr-btn" style={{ width: "100%" }} onClick={onGoUserSettings}>
                {labels.shell.userSettings}
              </button>
              {isAdmin && onGoAdminSettings ? (
                <button className="mr-btn" style={{ width: "100%" }} onClick={onGoAdminSettings}>
                  {labels.shell.adminSettings}
                </button>
              ) : null}
              <button className="mr-btn mr-btn--danger" style={{ width: "100%" }} onClick={onLogout}>
                {labels.shell.logout}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}

export function AppShell(props: Props) {
  const { labels } = useUiPreferences();

  return (
    <div className="mr-shell">
      <PrimaryNav onGoProjectHome={props.onGoProjectHome} onGoSettings={props.onGoSettings} onGoAbout={props.onGoAbout} />

      <main className="mr-shell__main">
        <Topbar
          title={labels.shell.topbarTitle}
          user={props.user}
          onLogout={props.onLogout}
          onGoUserSettings={props.onGoUserSettings}
          onGoAdminSettings={props.onGoAdminSettings}
        />

        {props.showUploads === false ? null : (
          <UploadPanel
            uploads={props.uploads ?? []}
            onClear={props.onClearUploads}
            onOpenItem={props.onOpenUploadItem}
            onLocateItem={props.onLocateUploadItem}
          />
        )}

        <div className="mr-shell__body">
          <aside className="mr-shell__sidebar">{props.left}</aside>
          <section className="mr-shell__center">{props.center}</section>
          <aside className={`mr-shell__inspector${props.inspectorOpen ? "" : " mr-shell__inspector--collapsed"}`}>{props.right}</aside>
        </div>
      </main>
    </div>
  );
}
