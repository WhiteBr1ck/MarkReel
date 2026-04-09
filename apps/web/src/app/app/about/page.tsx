"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function AboutPage() {
  const [backHref, setBackHref] = useState<string>("/app");

  useEffect(() => {
    setBackHref(localStorage.getItem("mr_last_workbench_url") || "/app");
  }, []);

  return (
    <main style={{ minHeight: "100vh", padding: 24 }}>
      <div style={{ width: "min(980px, 100%)", margin: "0 auto" }}>
        <div className="mr-panel" style={{ padding: 18 }}>
          <div style={{ opacity: 0.75, fontSize: 13 }}>关于</div>
          <h1 style={{ margin: "6px 0 0", fontSize: 26, letterSpacing: -0.4 }}>MarkReel</h1>
          <p style={{ margin: "10px 0 0", opacity: 0.85, lineHeight: 1.6 }}>
            MarkReel 是一个开源、自托管的视频审阅与标注工具。当前本地开发默认使用 SQLite 持久化数据，并持续打磨工作台上传、预览与批注体验。
          </p>
          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/" prefetch={false} className="mr-btn" style={{ textDecoration: "none", display: "inline-block" }}>
              返回首页
            </Link>
            <Link href={backHref} prefetch={false} className="mr-btn" style={{ textDecoration: "none", display: "inline-block" }}>
              返回工作台
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
