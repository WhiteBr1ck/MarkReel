import type { CSSProperties } from "react";

const card: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 16,
  padding: 20,
  background: "linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))",
  backdropFilter: "blur(10px)"
};

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background:
          "radial-gradient(900px 600px at 15% 20%, rgba(46, 196, 182, 0.18), transparent 60%), radial-gradient(900px 600px at 85% 75%, rgba(255, 209, 102, 0.12), transparent 60%), linear-gradient(180deg, #070a14, #0b1020 55%, #0a0f1f)"
      }}
    >
      <div style={{ width: "min(920px, 100%)" }}>
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <div>
              <div style={{ fontSize: 14, opacity: 0.75 }}>开源自托管 · 视频审阅与标注</div>
              <h1 style={{ margin: "8px 0 0", fontSize: 44, letterSpacing: -1 }}>
                MarkReel
              </h1>
              <p style={{ margin: "10px 0 0", maxWidth: 640, opacity: 0.9, lineHeight: 1.5 }}>
                上传视频，转码 HLS，在画面上直接标注；标注可显示作者并支持图片附件。
              </p>
            </div>
            <div style={{ alignSelf: "flex-start", textAlign: "right" }}>
              <a
                href="/app"
                style={{
                  color: "#e9eefc",
                  textDecoration: "none",
                  border: "1px solid rgba(255,255,255,0.14)",
                  padding: "10px 12px",
                  borderRadius: 12,
                  display: "inline-block"
                }}
              >
                进入应用
              </a>
            </div>
          </div>

          <div
            style={{
              marginTop: 18,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12
            }}
          >
            <div style={{ ...card, padding: 16 }}>
              <div style={{ fontWeight: 650 }}>登录与访客</div>
              <div style={{ opacity: 0.8, marginTop: 6, lineHeight: 1.4 }}>
                用户账号 + 分享链接访客；项目角色权限控制。
              </div>
            </div>
            <div style={{ ...card, padding: 16 }}>
              <div style={{ fontWeight: 650 }}>媒体处理</div>
              <div style={{ opacity: 0.8, marginTop: 6, lineHeight: 1.4 }}>
                上传原视频，可选压缩；异步 ffmpeg 转 HLS + 缩略图。
              </div>
            </div>
            <div style={{ ...card, padding: 16 }}>
              <div style={{ fontWeight: 650 }}>标注与导出</div>
              <div style={{ opacity: 0.8, marginTop: 6, lineHeight: 1.4 }}>
                时间点 + 位置叠加；图片附件；导出标注数据。
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 18,
              borderTop: "1px solid rgba(255,255,255,0.10)",
              paddingTop: 14,
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              opacity: 0.85,
              fontSize: 14
            }}
          >
            <span>启动（Docker）: `docker compose up --build`</span>
            <span>Web: http://localhost:5090</span>
            <span>API: http://localhost:4000/api</span>
            <span>MinIO: http://localhost:9001</span>
          </div>
        </div>
      </div>
    </main>
  );
}
