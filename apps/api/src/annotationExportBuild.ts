import { ZipArchive } from "archiver";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { env } from "./env";
import { presignInternalGetObject } from "./s3";
import {
  ANNOTATION_EXPORT_LIMITS as limits, AnnotationExportError, assertNotCancelled,
  attachmentExportName, exportCellText, exportTimecode, threadAnnotations,
  type ExportAttachment, type ExportInput, type ExportSnapshot, type ExportWarning
} from "./annotationExport";
import { annotationMediaFrameKey, cachedExportFrame, checkExportOutput, copyExportObject, exportFrameKey, extractExportFrame } from "./annotationExportFiles";

export type ExportBuildContext = {
  directory: string;
  signal: AbortSignal;
  progress: (completed: number, total: number, phase: string) => void;
  warnings: ExportWarning[];
};

function warn(context: ExportBuildContext, annotationId: string, attachmentId: string | undefined, error: unknown) {
  assertNotCancelled(context.signal);
  if (error instanceof AnnotationExportError && error.code === "ffmpeg_unavailable") throw error;
  const code = error instanceof AnnotationExportError ? error.code : "attachment_unavailable";
  context.warnings.push({ annotationId, attachmentId, code });
  return code;
}

async function copyAttachment(attachment: ExportAttachment, destination: string, remaining: number, context: ExportBuildContext) {
  if (!attachment.objectKey.startsWith("attachments/")) throw new AnnotationExportError("invalid_attachment_key");
  if (remaining <= 0) throw new AnnotationExportError("resource_limit", 413);
  return copyExportObject({ bucket: env.S3_BUCKET_ATTACHMENTS, objectKey: attachment.objectKey }, destination,
    Math.min(limits.attachmentBytes, remaining), context.signal);
}

export async function buildAnnotationZip(snapshot: ExportSnapshot, context: ExportBuildContext) {
  const attachments = snapshot.annotations.flatMap((annotation) => annotation.attachments);
  const entries: Array<{ annotationId: string; attachmentId: string; filename: string; status: "exported" | "failed"; bytes?: number; error?: string }> = [];
  const files: Array<{ filename: string; path: string }> = [];
  let totalBytes = 0;
  for (const [index, attachment] of attachments.entries()) {
    assertNotCancelled(context.signal);
    const filename = attachmentExportName(attachment, index);
    const destination = path.join(context.directory, `attachment-${index}`);
    try {
      const bytes = await copyAttachment(attachment, destination, limits.attachmentTotalBytes - totalBytes, context);
      totalBytes += bytes;
      files.push({ filename, path: destination });
      entries.push({ annotationId: attachment.annotationId, attachmentId: attachment.id, filename, status: "exported", bytes });
    } catch (error) {
      entries.push({ annotationId: attachment.annotationId, attachmentId: attachment.id, filename, status: "failed",
        error: warn(context, attachment.annotationId, attachment.id, error) });
    }
    context.progress(index + 1, attachments.length, "attachments");
  }
  assertNotCancelled(context.signal);
  context.progress(attachments.length, attachments.length, "packaging");
  const output = path.join(context.directory, "attachments.zip");
  const archive = new ZipArchive({ zlib: { level: 1 } });
  const completed = pipeline(archive, createWriteStream(output, { flags: "wx" }), { signal: context.signal });
  const cancel = () => archive.abort();
  context.signal.addEventListener("abort", cancel, { once: true });
  try {
    for (const file of files) archive.file(file.path, { name: file.filename });
    archive.append(JSON.stringify({ version: 1, mediaId: snapshot.media.id, videoVersion: snapshot.media.versionIndex,
      generatedAt: new Date().toISOString(), entries, warnings: context.warnings }, null, 2), { name: "manifest.json" });
    // Observe the pipeline immediately, including failures while finalization is running.
    await Promise.all([completed, archive.finalize()]);
  } finally {
    context.signal.removeEventListener("abort", cancel);
    archive.abort();
  }
  await checkExportOutput(output);
  return output;
}

export async function buildAnnotationWorkbook(snapshot: ExportSnapshot, context: ExportBuildContext) {
  const threads = threadAnnotations(snapshot.annotations);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MarkReel";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Annotations", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "序号", key: "number", width: 8 },
    { header: "视频版本", key: "version", width: 26 },
    { header: "时间码", key: "timecode", width: 18 },
    { header: "正文", key: "body", width: 48 },
    { header: "作者", key: "author", width: 20 },
    { header: "完成状态", key: "completed", width: 14 },
    { header: "原视频帧", key: "frame", width: 46 },
    { header: "附件绘制图", key: "attachments", width: 46 },
    { header: "回复", key: "replies", width: 55 },
    { header: "导出提示", key: "warnings", width: 32 }
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF35434A" } };
  sheet.getRow(1).height = 26;
  let downloadBytes = 0;
  let embeddedBytes = 0;
  let sourceUrl: string | undefined;
  const embed = (bytes: Buffer, column: number, row: number, top: number) => {
    embeddedBytes += bytes.length;
    if (embeddedBytes > limits.embeddedBytes) throw new AnnotationExportError("embedded_resource_limit", 413);
    const image = workbook.addImage({ buffer: bytes as unknown as ExcelJS.Buffer, extension: "jpeg" });
    sheet.addImage(image, { tl: { col: column, row: row - 1 + top }, ext: { width: 300, height: 169 }, editAs: "oneCell" });
  };
  for (const [index, thread] of threads.entries()) {
    assertNotCancelled(context.signal);
    const { root, replies } = thread;
    const members = [root, ...replies];
    const attachments = members.flatMap((annotation) => annotation.attachments);
    const warningStart = context.warnings.length;
    const replyText = replies.map((reply) => `${exportTimecode(reply.timestampMs)} ${reply.author.displayName || reply.author.username}: ${reply.body}`).join("\n\n");
    if (replyText.length > 32760) context.warnings.push({ annotationId: root.id, code: "reply_text_truncated" });
    const row = sheet.addRow({
      number: index + 1,
      version: exportCellText(`${snapshot.media.title} / V${snapshot.media.versionIndex}`),
      timecode: exportTimecode(root.timestampMs), body: exportCellText(root.body),
      author: exportCellText(root.author.displayName || root.author.username),
      completed: root.completedAt ? "已完成" : "未完成",
      replies: exportCellText(replyText)
    });
    row.alignment = { vertical: "top", wrapText: true };
    row.height = Math.min(409, Math.max(140, attachments.length * 140));
    row.getCell("body").numFmt = "@";
    row.getCell("replies").numFmt = "@";
    try {
      const file = snapshot.media.file;
      if (!file) throw new AnnotationExportError("source_unavailable");
      const key = annotationMediaFrameKey(snapshot.media.id, file, root.timestampMs);
      let frame = cachedExportFrame(key);
      if (!frame) {
        sourceUrl ??= await presignInternalGetObject({ bucket: env.S3_BUCKET_ORIGINAL, objectKey: file.originalObjectKey, expiresInSeconds: 600 });
        frame = await extractExportFrame(sourceUrl, root.timestampMs, key, context.signal, true);
      }
      embed(frame, 6, row.number, 0.02);
    } catch (error) {
      const code = warn(context, root.id, undefined, error);
      row.getCell("frame").value = exportCellText(code);
    }
    // Excel caps row height at 409 points. Multiple attachments share this height.
    const imageHeight = Math.min(169, (row.height! * 4 / 3 - 8) / Math.max(1, attachments.length));
    for (const [attachmentIndex, attachment] of attachments.entries()) {
      const destination = path.join(context.directory, `image-${index}-${attachmentIndex}`);
      try {
        downloadBytes += await copyAttachment(attachment, destination, limits.attachmentTotalBytes - downloadBytes, context);
        const bytes = await readFile(destination);
        const key = exportFrameKey(createHash("sha256").update(bytes).digest("hex"), 0);
        const image = await extractExportFrame(destination, 0, key, context.signal);
        embeddedBytes += image.length;
        if (embeddedBytes > limits.embeddedBytes) throw new AnnotationExportError("embedded_resource_limit", 413);
        const id = workbook.addImage({ buffer: image as unknown as ExcelJS.Buffer, extension: "jpeg" });
        sheet.addImage(id, {
          tl: { col: 7, row: row.number - 1 + attachmentIndex / Math.max(1, attachments.length) },
          ext: { width: imageHeight * 16 / 9, height: imageHeight }, editAs: "oneCell"
        });
      } catch (error) { warn(context, attachment.annotationId, attachment.id, error); }
      finally { await rm(destination, { force: true }); }
    }
    row.getCell("warnings").value = exportCellText(context.warnings.slice(warningStart)
      .map((warning) => `${warning.attachmentId ?? "frame"}: ${warning.code}`).join("\n"));
    context.progress(index + 1, threads.length, "rows");
  }
  sheet.autoFilter = { from: "A1", to: `J${Math.max(1, sheet.rowCount)}` };
  assertNotCancelled(context.signal);
  context.progress(threads.length, threads.length, "packaging");
  const output = path.join(context.directory, "annotations.xlsx");
  await workbook.xlsx.writeFile(output);
  assertNotCancelled(context.signal);
  await checkExportOutput(output);
  return output;
}

export function buildAnnotationExport(snapshot: ExportSnapshot, input: ExportInput, context: ExportBuildContext) {
  return input.format === "zip" ? buildAnnotationZip(snapshot, context) : buildAnnotationWorkbook(snapshot, context);
}
