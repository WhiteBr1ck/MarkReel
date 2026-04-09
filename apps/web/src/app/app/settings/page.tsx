"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ApiUser = { id: string; username: string; displayName: string | null };

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

    setBackHref(localStorage.getItem("mr_last_workbench_url") || "/app");
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
    <main style={{ minHeight: "100vh", padding: 24 }}>
      <div style={{ width: "min(980px, 100%)", margin: "0 auto" }}>
        <div className="mr-panel" style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
            <div>
              <div style={{ opacity: 0.75, fontSize: 13 }}>设置</div>
              <h1 style={{ margin: "6px 0 0", fontSize: 26, letterSpacing: -0.4 }}>用户与外观</h1>
            </div>
            <Link href={backHref} prefetch={false} className="mr-btn" style={{ textDecoration: "none", display: "inline-block" }}>
              返回工作台
            </Link>
          </div>

          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 12
            }}
          >
            <section className="mr-panel" style={{ padding: 14, boxShadow: "none" }}>
              <div style={{ fontWeight: 700 }}>当前用户</div>
              <div style={{ marginTop: 8, opacity: 0.85, lineHeight: 1.5 }}>
                {user ? (
                  <>
                    <div>用户名：{user.username}</div>
                    <div>昵称：{user.displayName ?? "(未设置)"}</div>
                    <div style={{ opacity: 0.7, fontSize: 12, marginTop: 6 }}>
                      当前为本地 SQLite 持久化模式，账号与项目会保存在项目本地数据库中。
                    </div>
                  </>
                ) : (
                  <div>未登录</div>
                )}
              </div>
            </section>

            <section className="mr-panel" style={{ padding: 14, boxShadow: "none" }}>
              <div style={{ fontWeight: 700 }}>主题</div>
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="mr-btn" onClick={() => setThemeAndPersist("dark")} disabled={theme === "dark"}>
                  深色
                </button>
                <button className="mr-btn" onClick={() => setThemeAndPersist("light")} disabled={theme === "light"}>
                  浅色
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
