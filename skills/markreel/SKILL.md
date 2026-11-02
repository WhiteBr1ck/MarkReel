---
name: markreel
description: Operate a MarkReel video-review server through its MCP tools or authenticated API. Use to upload or import footage, organize projects and media versions, read or write timestamped annotations, track completion, and export review deliverables. Does not apply to developing MarkReel's source code or to unrelated video-editing tools.
---

# MarkReel

Use the configured MarkReel MCP connection when available. Discover its actual tool names rather than guessing a namespace. A remote connection uses `https://SERVER/api/mcp` with `Authorization: Bearer TOKEN`; the ordinary `/app` webpage is not an MCP endpoint. The user creates and revokes tokens in User Settings > AI and MCP. Keep tokens out of chat, generated reports and source files.

Use the server and account the user selected. List projects and inspect the workspace before choosing IDs, particularly when names repeat or multiple media versions exist. Existing account permissions apply to every action; a permission error is not a reason to switch accounts or publish the project.

## Upload and Processing

Distinguish file locations:

- `upload_video` in a local stdio connection reads a path on the machine running that local MCP process.
- With remote MCP, use `prepare_video_upload` for a file on the AI client's computer. Transfer its bytes to the returned HTTP PUT address using the client's local file/HTTP capabilities and the same Bearer header, then call `process_uploaded_video` with the returned media ID, object key and mode. Preserve original quality unless the user requests compression.
- `browse_server_import` and `import_server_video` refer to the NAS/server's configured import root. Paths are relative to that root; a Windows desktop path is not a server import path.

When an MCP upload is unavailable but this environment can run Python, use [scripts/upload.py](scripts/upload.py), which streams the file directly to the existing API without installing a local service. Set `MARKREEL_URL` and `MARKREEL_TOKEN` through the client's secret environment. Run `python scripts/upload.py --help` for arguments. The helper can also fill an existing upload slot using `--media-id` and `--object-key`; do not create another slot for the same interrupted operation.

Uploading bytes and preparing playable media are separate stages. Check `get_processing_status` after uploading or importing, and report the actual processing state. A timeout can occur after the server has accepted work: inspect the recovery media ID and workspace before retrying. Retry only processing after a confirmed completed transfer; do not repeatedly upload or create duplicate records. Never send video bytes as base64 in an MCP JSON argument.

## Review and Annotations

All annotation timestamps are integer milliseconds. Convert an explicit timecode carefully: `01:23.500` is `83500`. Use known duration/frame-rate metadata when converting frames. Bind every annotation to the selected version's media ID; do not copy feedback to another version without a request.

Use top-level annotations for review items and `parentId` for discussion replies. Completion refers to top-level review items, not reply counts. Read existing annotations before a bulk write to avoid duplicating notes. Preserve existing text, attachments, colors and other reviewers' changes when editing.

Write notes grounded in the user's feedback or media the AI actually inspected. Use `get_video_frame` to inspect explicit timestamps when available; it returns a bounded preview, not the full-resolution original. A thumbnail or a few sampled frames are not evidence of the entire clip. MCP does not itself supply video understanding; do not claim to have watched a video when only metadata or sampled images were available.

Choose readable colors, concise actionable wording, and precise timestamps. Confirm persistence by reading back a sample after bulk mutations. For an incomplete bulk operation, report which items succeeded so that retries can target the remainder.

## Organize and Deliver

Use the established project/folder structure. Adding a new version preserves the prior media ID, annotations and ratings. Query version history and use the correct existing upload/version operation rather than manufacturing a `seriesId`.

Reuse the server's export endpoints or UI for image archives and XLSX review tables. Review exports should retain timestamps, completion state, authors and replies, and distinguish source frames from uploaded reference/drawing attachments. Do not replace an original reference image with a thumbnail.

Deletion, replacing project permissions and other destructive changes must match the user's requested scope. Use trash/restore when applicable and do not clear an entire project or bypass access controls to resolve a smaller failure.
