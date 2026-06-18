<p align="center">
  <img src="assets/logo.png" alt="MarkReel" width="96" height="96" />
</p>

<h1 align="center">MarkReel</h1>

<p align="center">自托管视频审阅与标注工具。</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-0.2.11-4f8f5d" />
  <img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0--only-555" />
</p>

## 功能

- 项目、文件夹和视频管理
- 视频上传、处理、播放和下载
- 时间点标注、回复、画面标记和图片附件
- 账号、组织、角色和权限管理
- 视频分享链接，支持查看或标注权限
- 标注导出到剪贴板、CSV、TXT 和章节文本

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

清空本地数据：

```bash
docker compose down -v
```

这个命令会删除账号、项目、媒体文件、对象存储和队列数据。

## License

AGPL-3.0-only
