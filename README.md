# MarkReel

MarkReel 是一个开源、自托管的视频审阅与标注工具，面向个人/小团队（1-50 人）。

核心能力（规划/建设中）：
- 上传视频：保留原视频或选择压缩
- 浏览器播放：HLS（m3u8）为主
- 视频标注：按时间点 + 画面位置标注，显示标注者
- 标注附件：支持插入图片
- 访客/外链：通过分享链接访问（可设置权限/过期）

## 快速开始（本机调试，不用 Docker）

前提：当前默认使用 `inmemory` 存储（开发模式），不需要 PostgreSQL。

可选依赖（有的话功能更完整）：
- Redis（用于队列/worker）：`localhost:6379`
- MinIO（用于对象存储）：`localhost:9000`

启动（Windows）：

```bash
npm run dev:local
```

启动（Linux/macOS）：

```bash
npm run dev:local:unix
```

打开：
- Web: http://localhost:5090
- API: http://localhost:4000/api

说明：
- `dev:local` 会写入一个 `.env.local`，用于保证本机环境走 `localhost`，避免 `.env` 里 docker 主机名导致连接失败。
- 如果你的 `5090` 或 `4000` 端口被占用，脚本会直接报错并提示 PID。

## 账号注册与登录

当前版本没有默认账号。

1. 打开 Web：`http://localhost:5090/app`
2. 点击“注册”，输入邮箱 + 密码（>= 8 位）创建账号
3. 之后用同一邮箱 + 密码登录

提示：当前默认是 `inmemory` 存储，重启 API 会清空已注册账号。

## Docker 部署（后续上线用）

准备：

```bash
cp .env.example .env
```

启动：

```bash
docker compose up --build
```

打开：
- Web: http://localhost:5090
- API: http://localhost:4000/api
- MinIO 控制台: http://localhost:9001

安全提示：
- 在公网暴露前务必修改 `.env` 中的 `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`。

## 从 inmemory 切换到 PostgreSQL（可还原）

当你准备接入数据库时：
1. 安装并启动 PostgreSQL
2. 设置 `.env`：
   - `MARKREEL_STORE=prisma`
   - `DATABASE_URL=postgresql://...`
3. 运行：`npm -w @markreel/api run db:generate`
4. 运行：`npm -w @markreel/api run db:push`


## 目录结构

- `apps/web` - Next.js WebUI
- `apps/api` - Fastify API
- `apps/worker` - 媒体处理 Worker（ffmpeg 任务）
- `packages/shared` - 共享类型/工具
- `infra` - Docker 与基础设施文件

## License

AGPL-3.0-only
