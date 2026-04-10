"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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

const principles = [
  {
    title: "项目优先",
    copy: "先围绕项目建立工作语境，再管理文件夹、视频、上传进度和回收站，减少信息散落。"
  },
  {
    title: "自托管可控",
    copy: "让部署节奏、存储边界和账号管理保留在自己的环境里，而不是被第三方流程牵着走。"
  },
  {
    title: "审阅路径收敛",
    copy: "上传、预览、逐帧查看和反馈尽量停留在同一条工作路径上，降低上下文切换。"
  }
];

export default function AboutPage() {
  const [backHref, setBackHref] = useState<string>("/app");

  useEffect(() => {
    setBackHref(sanitizeWorkbenchHref(localStorage.getItem("mr_last_workbench_url")));
  }, []);

  return (
    <main className="mr-page">
      <div className="mr-page__shell">
        <section className="mr-panel mr-page__hero">
          <div className="mr-page__hero-head">
            <div>
              <div className="mr-page__eyebrow">About</div>
              <h1 className="mr-page__title">MarkReel</h1>
              <p className="mr-page__lead">一个开源、自托管的视频审阅与标注工具，持续围绕上传、预览、逐帧查看和批注主路径打磨体验。</p>
            </div>
            <div className="mr-page__actions">
              <Link href="/" prefetch={false} className="mr-btn mr-page__link">
                返回首页
              </Link>
              <Link href={backHref} prefetch={false} className="mr-btn mr-page__link">
                返回工作台
              </Link>
            </div>
          </div>
        </section>

        <div className="mr-page__grid">
          {principles.map((item) => (
            <section key={item.title} className="mr-panel mr-page__card">
              <div className="mr-page__section-kicker">Principle</div>
              <h2 className="mr-page__section-title">{item.title}</h2>
              <p className="mr-page__note">{item.copy}</p>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
