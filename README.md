<p align="center">
  <img src="assets/logo.png" alt="MarkReel" width="96" height="96" />
</p>

<h1 align="center">MarkReel</h1>

<p align="center">自托管视频审阅与标注工具。</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-0.2.0-4f8f5d" />
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

只需要 Docker 和 Docker Compose。

1. 创建本机配置文件。

```bash
cp .env.example .env.docker
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env.docker
```

2. 默认管理员账号如下。

```text
用户名：admin
密码：adminadmin
```

如需在首次启动前修改管理员账号密码，只改 `.env.docker` 里的这两个字段：

```text
MARKREEL_ADMIN_USERNAME=admin
MARKREEL_ADMIN_PASSWORD=adminadmin
```

其他配置已有默认值，直接启动即可。

3. 启动。

```bash
docker compose up -d --build
```

4. 打开。

```text
http://localhost:5090
```

API、Redis、MinIO 和 Worker 不暴露宿主机端口。前端通过 `/api/*` 访问后端。

## 使用

1. 使用默认管理员账号 `admin` / `adminadmin` 登录，或使用 `.env.docker` 中配置的管理员账号登录。
2. 在管理员设置中创建账号和组织。
3. 创建项目，上传视频。
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

该命令会删除账号、项目、媒体文件、对象存储和队列数据。


## License

AGPL-3.0-only
