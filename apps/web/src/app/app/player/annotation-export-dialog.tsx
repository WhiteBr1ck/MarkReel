"use client";

import { IconDownload, IconFileZip, IconTableExport, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Dialog } from "../_components/dialog";
import {
  annotationExportBase, annotationExportError, annotationExportRequest, annotationExportWarning,
  downloadAnnotationAttachment, type AnnotationExportScope, type AnnotationExportTask
} from "./annotation-export-client";
import styles from "./annotation-export-dialog.module.css";

export { annotationAttachmentDownloadUrl, downloadAnnotationAttachment } from "./annotation-export-client";

export type AnnotationExportDialogProps = AnnotationExportScope & {
  open: boolean;
  onClose: () => void;
  mediaTitle?: string;
  annotationId?: string | null;
};

function isActive(task: AnnotationExportTask | null) { return task?.state === "queued" || task?.state === "running"; }

export function AnnotationExportDialog({ open, onClose, mediaId, mediaTitle, shareToken, sharePassword, annotationId }: AnnotationExportDialogProps) {
  const [format, setFormat] = useState<"xlsx" | "zip">("xlsx");
  const [status, setStatus] = useState<"all" | "completed" | "incomplete">("all");
  const [task, setTask] = useState<AnnotationExportTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollingFailed, setPollingFailed] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const taskRef = useRef<AnnotationExportTask | null>(null);
  const scopeRef = useRef<AnnotationExportScope>({ mediaId, shareToken, sharePassword });
  const requestRef = useRef<AbortController | null>(null);
  const startingRef = useRef(false);
  const radioName = useId();
  const progressId = useId();
  const scope = { mediaId, shareToken, sharePassword };
  taskRef.current = task;

  useEffect(() => {
    scopeRef.current = { mediaId, shareToken, sharePassword };
    setTask(null); setError(""); setBusy(false); setPollingFailed(false);
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = body.current?.closest<HTMLElement>("[role=dialog]");
    const first = dialog?.querySelector<HTMLElement>("input,button,select,a[href]");
    first?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex='0']")]
        .filter((element) => element.getClientRects().length > 0);
      const firstControl = controls[0];
      const lastControl = controls[controls.length - 1];
      if (!firstControl || !lastControl) return;
      if (event.shiftKey && (document.activeElement === firstControl || !dialog.contains(document.activeElement))) {
        event.preventDefault(); lastControl.focus();
      } else if (!event.shiftKey && (document.activeElement === lastControl || !dialog.contains(document.activeElement))) {
        event.preventDefault(); firstControl.focus();
      }
    };
    dialog?.addEventListener("keydown", trapFocus);
    const capturedScope = { mediaId, shareToken, sharePassword };
    return () => {
      requestRef.current?.abort();
      const pending = taskRef.current;
      if (isActive(pending)) void annotationExportRequest(capturedScope, `/${pending!.id}`, { method: "DELETE", keepalive: true }).catch(() => {});
      dialog?.removeEventListener("keydown", trapFocus);
      previousFocus?.focus();
    };
  }, [open, mediaId, shareToken, sharePassword, annotationId]);

  const poll = useCallback(async (id: string, signal?: AbortSignal) => {
    const result = await annotationExportRequest(scopeRef.current, `/${id}`, { signal });
    setTask(result.export);
    setPollingFailed(false);
    return result.export;
  }, []);

  useEffect(() => {
    if (!open || !isActive(task) || pollingFailed) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void poll(task!.id, controller.signal).catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(annotationExportError(failure)); setPollingFailed(true);
      });
    }, 1000);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, task, pollingFailed, poll]);

  async function start() {
    if (busy || isActive(task)) return;
    setBusy(true); setError(""); setPollingFailed(false);
    startingRef.current = true;
    const controller = new AbortController();
    requestRef.current = controller;
    const capturedScope = { ...scope };
    try {
      const result = await annotationExportRequest(capturedScope, "", {
        method: "POST", signal: controller.signal,
        body: JSON.stringify({ format, status, ...(annotationId ? { annotationId } : {}) })
      });
      if (controller.signal.aborted) {
        void annotationExportRequest(capturedScope, `/${result.export.id}`, { method: "DELETE" }).catch(() => {});
        return;
      }
      setTask(result.export);
    } catch (failure) { if (!controller.signal.aborted) setError(annotationExportError(failure)); }
    finally {
      if (requestRef.current === controller) startingRef.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function cancel(close = false) {
    if (close) {
      requestRef.current?.abort();
      if (isActive(task)) void annotationExportRequest(scope, `/${task!.id}`, { method: "DELETE", keepalive: true }).catch(() => {});
      setTask(null); setBusy(false); onClose();
      return;
    }
    if (startingRef.current) {
      requestRef.current?.abort(); startingRef.current = false; setBusy(false);
      return;
    }
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (isActive(task)) {
        const result = await annotationExportRequest(scope, `/${task!.id}`, { method: "DELETE" });
        setTask(result.export);
      }
    } catch (failure) { setError(annotationExportError(failure)); }
    finally { setBusy(false); }
  }

  async function download() {
    if (!task) return;
    setBusy(true); setError("");
    try {
      const current = await poll(task.id);
      if (current.state !== "completed") throw new Error("export_not_ready");
      const anchor = document.createElement("a");
      anchor.href = `/api${annotationExportBase(scope)}/annotation-exports/${task.id}/file`;
      anchor.download = current.filename;
      document.body.append(anchor); anchor.click(); anchor.remove();
    } catch (failure) { setError(annotationExportError(failure)); }
    finally { setBusy(false); }
  }

  const active = isActive(task);
  const completed = task?.state === "completed";
  const fraction = task?.total ? Math.round(task.completed / task.total * 100) : 0;
  const phase = task?.phase === "packaging" ? "正在生成文件" : task?.phase === "attachments" ? "正在读取附件" : task?.phase === "rows" ? "正在生成图文行" : "正在准备";

  return (
    <Dialog open={open} title={annotationId ? "导出此条标注" : "导出视频标注"} onClose={() => { void cancel(true); }}
      footer={<>
        <button className="mr-btn mr-btn--ghost" type="button" disabled={busy && !startingRef.current} onClick={() => { void cancel(active ? false : true); }}>
          {active ? <IconX size={16} aria-hidden="true" /> : null}{active ? "取消导出" : "关闭"}
        </button>
        {completed ? <button className="mr-btn mr-btn--primary" type="button" disabled={busy} onClick={() => { void download(); }}>
          <IconDownload size={16} aria-hidden="true" />下载文件
        </button> : <button className="mr-btn mr-btn--primary" type="button" disabled={busy || active} onClick={() => { void start(); }}>
          <IconTableExport size={16} aria-hidden="true" />{busy ? "处理中" : "开始导出"}
        </button>}
      </>}>
      <div ref={body} className={styles.body}>
        {mediaTitle ? <p className={styles.title}>{mediaTitle}</p> : null}
        <fieldset className={styles.formats} disabled={active || busy || completed}>
          <legend>文件格式</legend>
          <label><input type="radio" name={radioName} value="xlsx" checked={format === "xlsx"} onChange={() => setFormat("xlsx")} /><IconTableExport size={18} aria-hidden="true" />图文 XLSX</label>
          <label><input type="radio" name={radioName} value="zip" checked={format === "zip"} onChange={() => setFormat("zip")} /><IconFileZip size={18} aria-hidden="true" />附件 ZIP</label>
        </fieldset>
        <label className={styles.filter}>完成状态
          <select className="mr-input" value={status} disabled={active || busy || completed} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="all">全部</option><option value="completed">已完成</option><option value="incomplete">未完成</option>
          </select>
        </label>
        <div className={styles.status} role="status" aria-live="polite" aria-atomic="true">
          {active ? <>
            <label id={progressId}>{phase}{task!.total > 0 ? ` ${task!.completed} / ${task!.total}` : ""}</label>
            <progress aria-labelledby={progressId} max={100} value={task!.total > 0 ? fraction : undefined} />
          </> : completed ? <p>文件已就绪{task!.bytes !== undefined ? ` · ${task!.bytes < 1024 * 1024 ? `${Math.ceil(task!.bytes / 1024)} KiB` : `${(task!.bytes / 1024 / 1024).toFixed(1)} MiB`}` : ""}，10 分钟内可下载。</p>
            : task?.state === "cancelled" ? <p>导出已取消。</p> : null}
        </div>
        {task?.state === "failed" ? <p className={styles.error} role="alert">{annotationExportWarning(task.error ?? "export_failed")}</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {pollingFailed && active ? <button type="button" className="mr-btn mr-btn--ghost" onClick={() => {
          setError(""); void poll(task!.id).catch((failure: unknown) => setError(annotationExportError(failure)));
        }}>重新连接</button> : null}
        {task && task.warnings.length > 0 ? <details className={styles.warnings}>
          <summary>{task.warnings.length} 项内容未能导出</summary>
          <ul>{task.warnings.map((warning, index) => <li key={`${warning.annotationId}-${warning.attachmentId}-${index}`}>
            <span>{warning.attachmentId ?? warning.annotationId ?? "图片"}</span>：{annotationExportWarning(warning.code)}
          </li>)}</ul>
        </details> : null}
        {completed ? <button type="button" className="mr-btn mr-btn--ghost" disabled={busy} onClick={() => { setTask(null); setError(""); }}>重新选择</button> : null}
      </div>
    </Dialog>
  );
}

export function AnnotationAttachmentDownload(props: AnnotationExportScope & { annotationId: string; attachmentId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <span className={styles.attachmentDownload}>
    <button type="button" className="mr-btn mr-btn--ghost" title="下载原图" aria-label="下载原图" disabled={busy} onClick={() => {
      setBusy(true); setError("");
      void downloadAnnotationAttachment(props).catch((failure: unknown) => setError(annotationExportError(failure))).finally(() => setBusy(false));
    }}><IconDownload size={16} aria-hidden="true" /></button>
    {error ? <span className={styles.error} role="alert">{error}</span> : null}
  </span>;
}
