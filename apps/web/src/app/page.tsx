import Link from "next/link";

const features = [
  {
    kicker: "Review",
    title: "逐帧审阅素材",
    copy: "围绕项目组织视频、镜头与回收站，让审阅、比对与追踪保持在同一条工作路径上。"
  },
  {
    kicker: "Annotate",
    title: "直接留下标注与反馈",
    copy: "为素材补充评论、位置说明与版本语境，减少反复沟通和上下文丢失。"
  },
  {
    kicker: "Operate",
    title: "自托管且可控",
    copy: "保持你自己的部署节奏、存储边界与账号管理方式，不被第三方平台流程绑住。"
  }
];

const steps = [
  {
    index: "01",
    title: "创建项目并整理结构",
    copy: "先按项目聚合团队工作，再在项目内部管理文件夹、视频与回收站。"
  },
  {
    index: "02",
    title: "上传并等待处理",
    copy: "上传队列会持续反馈素材状态，你可以在工作台里继续处理其他内容。"
  },
  {
    index: "03",
    title: "回到同一处完成审阅",
    copy: "预览、标注、删除、恢复与项目信息都保留在同一个工作台语境里。"
  }
];

export default function HomePage() {
  return (
    <main className="mr-home">
      <div className="mr-home__shell">
        <section className="mr-panel mr-home__hero">
          <div className="mr-home__eyebrow">MarkReel · Self-hosted video review</div>
          <div className="mr-home__hero-grid">
            <div className="mr-home__copy">
              <h1 className="mr-home__title">让视频审阅回到更清楚、更克制的工作流里。</h1>
              <p className="mr-home__lead">
                MarkReel 是一套开源自托管的视频审阅与标注工具。它把项目、素材、上传进度、回收站与协作上下文收拢到同一个工作台里，让团队更容易保持秩序。
              </p>
              <div className="mr-home__actions">
                <Link className="mr-btn mr-btn--primary" href="/app">
                  进入工作台
                </Link>
                <Link className="mr-btn mr-btn--surface" href="/login">
                  登录 / 注册
                </Link>
              </div>
            </div>

            <div className="mr-home__stats">
              <div className="mr-panel mr-home__stat">
                <div className="mr-home__stat-label">Project-first</div>
                <div className="mr-home__stat-value">项目优先</div>
                <p className="mr-home__stat-copy">先选项目，再管理文件夹、视频、上传和回收站，信息架构更稳定。</p>
              </div>
              <div className="mr-panel mr-home__stat">
                <div className="mr-home__stat-label">Self-hosted</div>
                <div className="mr-home__stat-value">自托管</div>
                <p className="mr-home__stat-copy">适合需要自主掌控数据、流程与部署环境的小团队或内部内容系统。</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mr-panel mr-home__section">
          <div className="mr-home__section-head">
            <div>
              <h2 className="mr-home__section-title">围绕审阅主路径做减法。</h2>
              <p className="mr-home__section-copy">
                不追求堆叠功能，而是把上传、浏览、预览、回收与项目信息放到一套统一界面里，让常用操作更顺手。
              </p>
            </div>
          </div>
          <div className="mr-home__grid">
            {features.map((feature) => (
              <article key={feature.title} className="mr-panel mr-home__feature">
                <div className="mr-home__feature-kicker">{feature.kicker}</div>
                <h3 className="mr-home__feature-title">{feature.title}</h3>
                <p className="mr-home__feature-copy">{feature.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mr-panel mr-home__section">
          <div className="mr-home__section-head">
            <div>
              <h2 className="mr-home__section-title">三步进入工作状态。</h2>
              <p className="mr-home__section-copy">从项目建立到素材回看，界面尽量保持同一种语言和层级，不让人频繁跳出上下文。</p>
            </div>
          </div>
          <div className="mr-home__steps">
            {steps.map((step) => (
              <article key={step.index} className="mr-panel mr-home__step">
                <div className="mr-home__step-index">{step.index}</div>
                <h3 className="mr-home__step-title">{step.title}</h3>
                <p className="mr-home__step-copy">{step.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <footer className="mr-home__footer">
          <div>开源自托管的视频审阅与标注工具。</div>
          <div className="mr-home__footer-links">
            <Link className="mr-home__link" href="/app/about">
              关于
            </Link>
            <Link className="mr-home__link" href="/app/settings">
              设置
            </Link>
            <Link className="mr-home__link" href="/app">
              工作台
            </Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
