import { api, refreshSession, type ApiError } from "../_components/api";

export type AnnotationExportScope = { mediaId: string; shareToken?: string | null; sharePassword?: string };
export type AnnotationExportTask = {
  id: string;
  mediaId: string;
  format: "xlsx" | "zip";
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  phase: string;
  completed: number;
  total: number;
  warnings: Array<{ annotationId?: string; attachmentId?: string; code: string }>;
  error?: string;
  filename: string;
  bytes?: number;
  expiresAt: string;
};

export function annotationExportBase(scope: AnnotationExportScope) {
  const media = `/media/${encodeURIComponent(scope.mediaId)}`;
  return scope.shareToken ? `/share/${encodeURIComponent(scope.shareToken)}${media}` : media;
}

export function annotationAttachmentDownloadUrl(scope: AnnotationExportScope & { annotationId: string; attachmentId: string }) {
  return `/api${annotationExportBase(scope)}/annotations/${encodeURIComponent(scope.annotationId)}/attachments/${encodeURIComponent(scope.attachmentId)}/download`;
}

export function annotationExportHeaders(scope: AnnotationExportScope) {
  const headers = new Headers();
  if (scope.sharePassword) headers.set("x-markreel-share-password", scope.sharePassword);
  return headers;
}

export async function annotationExportRequest(scope: AnnotationExportScope, suffix: string, init?: RequestInit): Promise<{ export: AnnotationExportTask }> {
  const path = `${annotationExportBase(scope)}/annotation-exports${suffix}`;
  const headers = annotationExportHeaders(scope);
  const signal = init?.signal ?? AbortSignal.timeout(30000);
  if (init?.body) headers.set("content-type", "application/json");
  if (!scope.shareToken) return api(path, { ...init, headers, signal });
  const response = await fetch(`/api${path}`, { ...init, headers, signal, credentials: "include", cache: "no-store" });
  const data = await response.json().catch(() => ({})) as { error?: string; export: AnnotationExportTask };
  if (!response.ok) throw Object.assign(new Error(data.error ?? "export_failed"), { status: response.status, data });
  return data;
}

const errorMessages: Record<string, string> = {
  unauthorized: "登录已失效，请重新登录。", forbidden: "没有导出权限。", not_found: "内容或导出任务不存在，可能已过期。",
  revoked: "分享链接已撤销。", expired: "分享链接已过期。", max_uses_reached: "分享链接已达到访问次数上限。",
  invalid_share_password: "请重新验证分享密码。", exports_require_persistent_store: "当前临时存储模式不支持导出。",
  annotation_resource_limit: "标注超过 2000 条，无法导出。", row_resource_limit: "顶层标注超过 200 条，请缩小范围。",
  attachment_resource_limit: "附件超过 300 个，请缩小范围。", resource_limit: "附件超过大小限额。",
  source_unavailable: "原视频不可用，未能提取视频帧。",
  export_limit_reached: "导出任务已达上限，请稍后重试。", ffmpeg_unavailable: "服务端未安装 ffmpeg，无法生成图文表格。",
  frame_unavailable: "图片或视频帧无法解码。", attachment_unavailable: "附件读取失败。", invalid_attachment_key: "附件地址无效。",
  embedded_resource_limit: "内嵌图片超过大小限额。", export_failed: "导出失败，请重试。", export_timeout: "导出超时，请缩小范围后重试。",
  reply_text_truncated: "回复超过 Excel 单元格上限，已截断。",
  export_cancelled: "导出已取消。", export_not_ready: "文件尚未准备好。"
};

export function annotationExportError(error: unknown) {
  const failure = error as ApiError;
  const data = failure?.data as { error?: string } | undefined;
  const code = data?.error ?? failure?.message ?? "export_failed";
  return errorMessages[code] ?? "导出请求失败，请重试。";
}

export function annotationExportWarning(code: string) { return errorMessages[code] ?? code; }

export async function downloadAnnotationAttachment(scope: AnnotationExportScope & { annotationId: string; attachmentId: string }) {
  const url = annotationAttachmentDownloadUrl(scope);
  const request = () => fetch(url, { headers: annotationExportHeaders(scope), credentials: "include", cache: "no-store" });
  let response = await request();
  if (response.status === 401 && !scope.shareToken) { await refreshSession(); response = await request(); }
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => ({}));
    throw Object.assign(new Error("export_failed"), { data });
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const filename = response.headers.get("content-disposition")?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename ? decodeURIComponent(filename) : `attachment-${scope.attachmentId}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
}
