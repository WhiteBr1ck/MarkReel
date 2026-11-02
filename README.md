<p align="center">
  <img src="assets/logo.png" alt="MarkReel" width="96" height="96" />
</p>

<h1 align="center">MarkReel</h1>

<p align="center">自托管视频审阅与标注工具。</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-0.2.17-4f8f5d" />
  <img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0--only-555" />
</p>

## 功能

- 项目、文件夹和视频管理
- 视频上传、处理、播放和下载
- 时间点标注、回复、画面标记和图片附件
- 账号、组织、角色和权限管理
- 视频分享链接，支持查看或标注权限
- 标注导出到剪贴板、CSV、TXT 和章节文本
- MCP 接入 AI 客户端，管理项目、上传视频和读写批注

## 部署

需要 Docker 和 Docker Compose。

1. 创建配置文件。

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

2. 修改管理员账号或密钥（可选）。

默认管理员账号是 `admin`，密码是 `adminadmin`。如果要对外开放服务，至少修改 `.env` 里的这些值：

```text
MARKREEL_ADMIN_USERNAME=admin
MARKREEL_ADMIN_PASSWORD=adminadmin
JWT_ACCESS_SECRET=change_this_to_a_long_random_string
JWT_REFRESH_SECRET=change_this_to_another_long_random_string
```

3. 添加服务器路径导入目录（可选）。

如果不需要从 NAS 或服务器本地路径导入视频，跳过这步。需要的话，在 `docker-compose.yml` 的 `api.volumes` 里把宿主机目录挂到 `/imports` 下。建议每个来源一个子目录：

```yaml
services:
  api:
    volumes:
      - sqlite-data:/app/data
      - D:/Videos:/imports/Videos:ro
      - Z:/NAS/Projects:/imports/NAS-Projects:ro
```

Linux 示例：

```yaml
services:
  api:
    volumes:
      - sqlite-data:/app/data
      - /mnt/nas/videos:/imports/NAS:ro
```

4. 配置直传地址（可选）。

MarkReel 会自动尝试让浏览器直传到 MinIO。失败时会自动回退到 `/api` 代理上传，所以本机部署通常不用改。

如果你明确知道浏览器应该访问哪个 MinIO 地址，可以在 `.env` 里指定：

```text
S3_PUBLIC_ENDPOINT=http://你的服务器IP:9000
```

Docker Compose 默认只把 MinIO 绑定到本机 `127.0.0.1:9000`。如果要让局域网机器直连 MinIO，把 `docker-compose.yml` 里的端口改成：

```yaml
ports:
  - "9000:9000"
```

5. 启动。

```bash
docker compose up -d --build
```

6. 打开。

```text
http://localhost:5090
```

7. 连接 AI 客户端（可选）。

NAS 的 Docker 部署已包含远程 MCP，电脑上无需再运行服务。登录「用户设置 → AI 与 MCP」，复制 MCP 地址并创建访问令牌。在支持远程 MCP 和自定义请求头的 AI 客户端中配置：

```json
{
  "mcpServers": {
    "markreel": {
      "url": "http://NAS_IP:5090/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_ACCESS_TOKEN"
      }
    }
  }
}
```

外网可用原有 HTTPS 域名，例如 `https://markreel.example.com/api/mcp`，无需新增对外端口。访问令牌继承当前账号权限，可设为只读，也可随时撤销；到期、账号停用或修改密码后失效。当前认证方式是 Bearer 令牌，客户端需要支持设置该请求头；只支持 OAuth 登录的客户端暂不能直接连接。

AI 可查询、新建、重命名和删除项目与文件夹，整理视频，读取缩略图和技术信息，上传本地视频或导入服务器目录视频，添加、回复、编辑、完成和删除批注。所有操作使用配置账号的现有权限，也会进入现有 API 审计流程。

服务器目录里的视频用 `browse_server_import` 和 `import_server_video`，路径相对于第 3 步的挂载目录。电脑上的视频用 `prepare_video_upload` 获取上传地址，由 AI 客户端的本地文件/HTTP 工具传输，再调用 `process_uploaded_video`。上传默认保留原片，完成后用 `get_processing_status` 查询处理状态。失败返回 `recovery` 时先检查该素材，避免重复上传。反向代理和客户端各自的超时、上传大小限制仍然适用。

同一设置页可以下载操作 Skill。将 ZIP 中的 `markreel` 文件夹放入 AI 客户端的技能目录；仓库内源码位于 `skills/markreel`。Skill 包含一个仅依赖 Python 标准库的流式上传脚本，无需本地常驻服务，使用环境变量 `MARKREEL_URL` 和 `MARKREEL_TOKEN`。

只支持本地 stdio MCP 的客户端（可选）：在电脑上安装 Node.js 22+，运行 `npm ci` 和 `npm -w @markreel/mcp run build`，然后以 `node /absolute/path/MarkReel/apps/mcp/dist/main.js` 启动；环境变量设为 `MARKREEL_MCP_BASE_URL` 与 `MARKREEL_MCP_API_TOKEN`。这时 `upload_video` 读取运行 MCP 的电脑上的文件，优先直传，失败后回退 API。还支持以下配置（可选）：

| 配置 | 默认值 | 用途 |
| --- | --- | --- |
| `MARKREEL_MCP_READ_ONLY` | `false` | 设为 `true` 只提供查询工具 |
| `MARKREEL_MCP_UPLOAD_ROOTS` | 不限制 | 限制本地视频来源目录；Windows 用分号分隔，Linux/macOS 用冒号分隔 |
| `MARKREEL_MCP_TRANSFER_TIMEOUT_SECONDS` | `3600` | 上传、导入和处理请求的最长等待秒数 |

MCP 提供操作接口，不自带视频理解模型。支持视觉输入的 AI 可读取缩略图或用 `get_video_frame` 获取指定时间的预览帧，再写入时间点批注；截帧复用有并发限制的服务端缓存。整段视频的自动分析与候选标注审核尚未内置。

## 使用

1. 用管理员账号登录。
2. 在管理员设置中创建账号和组织。
3. 创建项目，上传视频，或在上传弹窗中选择服务器路径导入。
4. 视频处理完成后进入审片播放器。
5. 添加标注、回复、附件或画面标记。
6. 按需要配置视频权限或分享链接。

## 运维

查看服务：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f --tail=120 api worker web
```

停止：

```bash
docker compose down
```

升级前备份持久化数据，再运行 `docker compose up -d --build`。启动时会自动完成 SQLite 结构同步，包括视频版本编号校正，不需要手动执行数据丢失选项。

维护发布版本时用 `npm run release:version -- 0.2.17` 同步所有包、内部依赖、锁文件和 README 徽标，再运行 `npm run version:check` 校验。此命令不会自动提交、创建 Git tag 或推送。

清空本地数据：

```bash
docker compose down -v
```

这个命令会删除账号、项目、媒体文件、对象存储和队列数据。

## License

AGPL-3.0-only
