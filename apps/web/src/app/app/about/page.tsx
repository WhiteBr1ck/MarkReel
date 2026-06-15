"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import packageJson from "../../../../package.json";

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

const features = ["项目与文件夹管理", "视频上传、处理与播放", "时间点标注、回复与附件", "组织、权限和分享链接"];
const repositoryUrl = "https://github.com/WhiteBr1ck/MarkReel";

export default function AboutPage() {
  const [backHref, setBackHref] = useState<string>("/app");

  useEffect(() => {
    setBackHref(sanitizeWorkbenchHref(localStorage.getItem("mr_last_workbench_url")));
  }, []);

  return (
    <main className="mr-page">
      <div className="mr-page__shell mr-page__shell--narrow">
        <section className="mr-panel mr-page__hero mr-about-card">
          <div className="mr-page__hero-head">
            <div className="mr-about-card__brand">
              <img src="/logo.png" alt="MarkReel" />
              <div>
                <div className="mr-page__eyebrow">About</div>
                <h1 className="mr-page__title">MarkReel</h1>
              </div>
            </div>
            <Link href={backHref} prefetch={false} className="mr-btn mr-page__link">
              返回工作台
            </Link>
          </div>
        </section>

        <div className="mr-page__grid mr-page__grid--two">
          <section className="mr-panel mr-page__card">
            <div className="mr-page__section-kicker">Version</div>
            <h2 className="mr-page__section-title">v{packageJson.version}</h2>
            <p className="mr-page__note">自托管视频审阅与标注工具。</p>
          </section>

          <section className="mr-panel mr-page__card">
            <div className="mr-page__section-kicker">Repository</div>
            <a className="mr-about-card__repo-link" href={repositoryUrl} target="_blank" rel="noreferrer">
              <span className="mr-page__section-title">MarkReel</span>
              <span>WhiteBr1ck · GitHub Repository</span>
            </a>
          </section>
        </div>

        <section className="mr-panel mr-page__card">
          <div className="mr-page__section-kicker">Features</div>
          <h2 className="mr-page__section-title">当前功能</h2>
          <div className="mr-about-card__feature-list">
            {features.map((feature) => (
              <span key={feature}>{feature}</span>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
