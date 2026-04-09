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

const SURFACE_SOFT = "var(--surface-soft)";

function Avatar({ name }: { name: string }) {
  const initial = (name.trim()[0] ?? "U").toUpperCase();
  return (
    <div
      style={{
        width: 42,
        height: 42,
        borderRadius: 16,
        display: "grid",
        placeItems: "center",
        border: "1px solid rgba(70,217,200,0.28)",
        background:
          "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.2), transparent 35%), linear-gradient(180deg, rgba(70,217,200,0.22), rgba(115,132,255,0.18))",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 14px 30px rgba(0,0,0,0.24)",
        fontWeight: 900,
        letterSpacing: -0.3
      }}
      aria-label="用户"
    >
      {initial}
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
  const { theme, toggle } = useTheme();

  function NavButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
    return (
      <button
        onClick={onClick}
        title={title}
        style={{
          width: 48,
          height: 48,
          borderRadius: 16,
          display: "grid",
          placeItems: "center",
          border: "1px solid rgba(148,163,184,0.14)",
          background: SURFACE_SOFT,
          color: "var(--text)",
          cursor: "pointer",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)"
        }}
      >
        {children}
      </button>
    );
  }

  return (
    <aside
      style={{
        width: 88,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        borderRight: "1px solid var(--border2)",
        background: "var(--nav-bg)",
        boxShadow: "inset -1px 0 0 rgba(255,255,255,0.03)"
      }}
    >
      <div
        style={{
          height: 56,
          borderRadius: 18,
          display: "grid",
          placeItems: "center",
          background:
            "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.18), transparent 34%), linear-gradient(180deg, rgba(70,217,200,0.24), rgba(115,132,255,0.2))",
          border: "1px solid rgba(70,217,200,0.3)",
          color: "white",
          fontWeight: 900,
          letterSpacing: -0.8,
          boxShadow: "0 20px 30px rgba(0,0,0,0.26)"
        }}
        title="MarkReel"
      >
        MR
      </div>

      <div style={{ display: "grid", gap: 10 }}>
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

      <div style={{ flex: 1 }} />

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
    <div style={{ padding: "14px 18px 0" }}>
      <div
        className="mr-panel"
        style={{
          padding: 14,
          boxShadow: "none",
          background: "linear-gradient(180deg, color-mix(in srgb, var(--accent) 8%, transparent), transparent 45%), var(--surface-soft)"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1.1 }}>Upload Queue</div>
            <div style={{ fontSize: 18, fontWeight: 900, marginTop: 3 }}>上传与处理进度</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="mr-badge mr-badge--accent">{uploads.length} 项任务</span>
            {activeCount > 0 ? <span className="mr-badge">{activeCount} 进行中</span> : null}
            <button className="mr-btn" type="button" onClick={onClear}>
              清空记录
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {uploads.map((item) => {
            const isReady = item.stage === "ready";
            const isError = item.stage === "error";
            return (
              <div
                key={item.id}
                style={{
                  border: `1px solid ${isError ? "rgba(255,93,115,0.26)" : isReady ? "rgba(70,217,200,0.24)" : "var(--border2)"}`,
                  borderRadius: 16,
                  padding: 12,
                  background: isError
                    ? "linear-gradient(180deg, rgba(255,93,115,0.08), rgba(255,93,115,0.03))"
                    : isReady
                      ? "linear-gradient(180deg, rgba(70,217,200,0.09), rgba(70,217,200,0.03))"
                      : "var(--surface-soft)"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.fileName}</div>
                    <div style={{ marginTop: 5, fontSize: 12, color: "var(--muted)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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

                {item.error ? <div style={{ marginTop: 8, fontSize: 12, color: "var(--danger)" }}>{item.error}</div> : null}
                {item.mediaId ? (
                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
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
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        padding: 18,
        paddingBottom: 12,
        background: "var(--topbar-bg)",
        backdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--border2)"
      }}
    >
      <div
        className="mr-panel"
        style={{
          padding: 16,
          boxShadow: "none",
          background: "var(--hero-bg)"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ minWidth: 220, flex: "1 1 220px" }}>
            <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1.2 }}>Workbench</div>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.6, marginTop: 4 }}>{title}</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" onClick={() => setMenuOpen((s) => !s)} style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", color: "var(--text)" }} title="用户">
              <Avatar name={userName} />
            </button>
          </div>
        </div>

        {menuOpen ? (
          <div className="mr-panel" data-mr-menu style={{ position: "absolute", right: 18, top: 88, width: 236, padding: 12, boxShadow: "var(--shadow)", zIndex: 25 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>当前用户</div>
            <div style={{ fontWeight: 900, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis" }}>{userName}</div>
            <div style={{ height: 10 }} />
            <button className="mr-btn" style={{ width: "100%" }} onClick={onGoSettings}>
              用户设置
            </button>
            <div style={{ height: 8 }} />
            <button className="mr-btn mr-btn--danger" style={{ width: "100%" }} onClick={onLogout}>
              退出登录
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

export function AppShell(props: Props) {
  return (
    <div style={{ minHeight: "100vh", display: "flex" }}>
      <PrimaryNav onGoProjectHome={props.onGoProjectHome} onGoSettings={props.onGoSettings} onGoAbout={props.onGoAbout} />

      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
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

        <div style={{ display: "flex", minHeight: 0, flex: 1, gap: 0 }}>
          <aside
            style={{
              width: 320,
              borderRight: "1px solid var(--border2)",
              background: "var(--sidebar-bg)",
              padding: 18,
              display: "grid",
              alignContent: "start",
              gap: 14
            }}
          >
            {props.left}
          </aside>

          <section style={{ flex: 1, minWidth: 0, padding: 18 }}>{props.center}</section>
          <aside
            style={{
              width: props.inspectorOpen ? 340 : 92,
              borderLeft: "1px solid var(--border2)",
              background: "var(--sidebar-bg)",
              padding: 18,
              transition: "width 0.18s ease"
            }}
          >
            {props.right}
          </aside>
        </div>
      </main>
    </div>
  );
}
