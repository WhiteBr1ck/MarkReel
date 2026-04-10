"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ApiUser = { id: string; username: string; displayName: string | null };

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
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    credentials: "include"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error("api_error"), { status: res.status, data });
  return data as T;
}

export default function SettingsPage() {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [backHref, setBackHref] = useState<string>("/app");

  useEffect(() => {
    const saved = (localStorage.getItem("mr_theme") as any) || "dark";
    const t = saved === "light" ? "light" : "dark";
    setTheme(t);
    document.documentElement.dataset.theme = t;

    setBackHref(sanitizeWorkbenchHref(localStorage.getItem("mr_last_workbench_url")));
  }, []);

  useEffect(() => {
    void api<{ user: ApiUser }>("/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  function setThemeAndPersist(t: "dark" | "light") {
    setTheme(t);
    localStorage.setItem("mr_theme", t);
    document.documentElement.dataset.theme = t;
  }

  return (
    <main className="mr-page">
      <div className="mr-page__shell">
        <section className="mr-panel mr-page__hero">
          <div className="mr-page__hero-head">
            <div>
              <div className="mr-page__eyebrow">Settings</div>
              <h1 className="mr-page__title">用户与界面偏好</h1>
              <p className="mr-page__lead">统一管理当前账号信息、主题外观和返回工作台的入口，不打断已有工作流。</p>
            </div>
            <Link href={backHref} prefetch={false} className="mr-btn mr-page__link">
              返回工作台
            </Link>
          </div>
        </section>

        <div className="mr-page__grid">
          <section className="mr-panel mr-page__card">
            <div className="mr-page__section-kicker">Account</div>
            <h2 className="mr-page__section-title">当前用户</h2>
            <div className="mr-page__meta-list">
              {user ? (
                <>
                  <div className="mr-page__meta-item">
                    <span>用户名</span>
                    <strong>{user.username}</strong>
                  </div>
                  <div className="mr-page__meta-item">
                    <span>昵称</span>
                    <strong>{user.displayName ?? "(未设置)"}</strong>
                  </div>
                  <p className="mr-page__note">当前为本地 SQLite 持久化模式，账号与项目会保存在项目本地数据库中。</p>
                </>
              ) : (
                <p className="mr-page__note">当前还没有可用的登录信息。</p>
              )}
            </div>
          </section>

          <section className="mr-panel mr-page__card">
            <div className="mr-page__section-kicker">Appearance</div>
            <h2 className="mr-page__section-title">主题模式</h2>
            <p className="mr-page__note">界面会立即应用选择结果，并写入本地偏好，后续回到工作台时继续沿用。</p>
            <div className="mr-page__actions">
              <button className={`mr-btn mr-btn--surface${theme === "dark" ? " mr-btn--primary" : ""}`} onClick={() => setThemeAndPersist("dark")} disabled={theme === "dark"}>
                深色
              </button>
              <button className={`mr-btn mr-btn--surface${theme === "light" ? " mr-btn--primary" : ""}`} onClick={() => setThemeAndPersist("light")} disabled={theme === "light"}>
                浅色
              </button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
