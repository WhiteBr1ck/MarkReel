import assert from "node:assert/strict";
import test from "node:test";
import { attachmentExportName, exportCellText, exportDisposition, exportTimecode, safeExportName, threadAnnotations, type ExportAnnotation } from "./annotationExport";

test("export names resist traversal, control characters, device names and duplicate basenames", () => {
  assert.equal(safeExportName("../../bad\r\nname.png"), "_.._bad__name.png");
  assert.equal(safeExportName("CON.png"), "attachment");
  assert.equal(safeExportName("..."), "attachment");
  const attachment = { id: "id", annotationId: "a", objectKey: "attachments/a/image.png", mimeType: "image/png", width: null, height: null };
  assert.notEqual(attachmentExportName(attachment, 0), attachmentExportName(attachment, 1));
  assert.ok(!attachmentExportName(attachment, 0).includes("/"));
  assert.ok(!exportDisposition("evil\r\nx.png").includes("\r"));
  assert.match(exportDisposition("图文.xlsx"), /filename\*=UTF-8''%/);
});

test("cell strings neutralize formula prefixes including leading whitespace", () => {
  for (const value of ["=HYPERLINK(\"x\")", "+1", "-2", "@SUM(1)", "\t\r=cmd", "\uFEFF=cmd"]) assert.ok(exportCellText(value).startsWith("'"));
  assert.equal(exportCellText("review note"), "review note");
  assert.equal(exportCellText("a\x00b"), "ab");
  assert.equal(exportCellText("a".repeat(40000)).length, 32760);
  assert.equal(exportTimecode(3723123), "01:02:03.123");
});

test("thread grouping merges nested replies but excludes orphans and cycles", () => {
  const annotation = (id: string, parentId: string | null): ExportAnnotation => ({
    id, parentId, timestampMs: 0, body: id, completedAt: null, createdAt: new Date(),
    author: { username: "u", displayName: null }, attachments: []
  });
  const groups = threadAnnotations([annotation("reply", "root"), annotation("nested", "reply"), annotation("root", null),
    annotation("orphan", "deleted"), annotation("cycle1", "cycle2"), annotation("cycle2", "cycle1")]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].replies.map((reply) => reply.id), ["reply", "nested"]);
});
