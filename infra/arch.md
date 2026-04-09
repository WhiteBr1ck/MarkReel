# Architecture Notes

Target: individuals / small teams (1-50 users), single-node self-hosted.

## Core services

- `web` (Next.js): UI + video player + annotation layer.
- `api` (Fastify): auth, projects, media, annotations, share links.
- `worker` (Node + ffmpeg): async media processing (transcode, thumbnails).
- `postgres`: system of record.
- `redis`: queue + short-lived cache.
- `minio`: S3-compatible object storage for originals/derived/attachments.

## Media pipeline

Upload -> object storage -> enqueue job -> ffprobe -> (optional) keep original -> transcode to HLS -> thumbnails/poster -> mark ready.

## Strongly recommended self-host features

- Quotas: per-user/per-project storage limits.
- Retention: auto-prune old derived assets.
- Soft delete: reversible deletes for projects/media/annotations.
- Audit log: record who did what, when (security + compliance).
- Export: annotations to JSON/CSV/PDF.
- Versions: multiple uploads per logical asset.
- Review workflow: open / needs-changes / approved.

## Implementation pointers

- Prefer browser playback source as HLS (`.m3u8`).
- Prefer direct-to-S3 uploads via presigned URLs.
- Store geometry in normalized coordinates (0..1) so it survives different player sizes.
