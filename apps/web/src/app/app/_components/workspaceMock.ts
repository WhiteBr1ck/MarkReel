import type { SortMode, WorkspaceItem } from "./shell";

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pick<T>(arr: T[], n: number) {
  return arr[n % arr.length]!;
}

export type MockDb = {
  itemsByFolderId: Record<string, WorkspaceItem[]>;
};

export function buildMockDbForProject(projectId: string) {
  const base = hash(projectId);
  const now = Date.now();

  const root = `root-${projectId}`;
  const fIncoming = `f-${projectId}-incoming`;
  const fIncoming2026 = `f-${projectId}-incoming-2026`;
  const fIncomingRef = `f-${projectId}-incoming-ref`;
  const fCuts = `f-${projectId}-cuts`;
  const fCutsV1 = `f-${projectId}-cuts-v1`;
  const fDelivery = `f-${projectId}-delivery`;

  const wordsA = ["雷神", "演示", "样片", "预告", "访谈", "横版", "竖版", "剪辑", "录屏", "实拍", "脚本", "镜头"];
  const wordsB = ["v1", "v2", "终版", "加字幕", "调色", "降噪", "配乐", "高码率", "低码率", "交付", "复审"];

  function video(idSeed: number): WorkspaceItem {
    const a = pick(wordsA, base + idSeed);
    const b = pick(wordsB, base + idSeed * 3);
    const dur = 20 + ((base + idSeed) % 220);
    const size = 18_000_000 + ((base + idSeed * 97) % 1_200_000_000);
    return {
      id: `v-${projectId}-${idSeed}`,
      kind: "video",
      name: `${a}-${b}-${String(2026)}${String(3).padStart(2, "0")}${String((idSeed % 28) + 1).padStart(2, "0")}.mp4`,
      updatedAt: now - ((base + idSeed * 13) % (1000 * 60 * 60 * 24 * 20)),
      durationSeconds: dur,
      sizeBytes: size
    };
  }

  const itemsByFolderId: Record<string, WorkspaceItem[]> = {};

  itemsByFolderId[root] = [
    { id: fIncoming, kind: "folder", name: "收件箱", updatedAt: now - 1000 * 60 * 60 * 2 },
    { id: fCuts, kind: "folder", name: "剪辑", updatedAt: now - 1000 * 60 * 60 * 7 },
    { id: fDelivery, kind: "folder", name: "交付", updatedAt: now - 1000 * 60 * 60 * 26 },
    video(1),
    video(2)
  ];

  itemsByFolderId[fIncoming] = [
    { id: fIncoming2026, kind: "folder", name: "2026-03", updatedAt: now - 1000 * 60 * 30 },
    { id: fIncomingRef, kind: "folder", name: "参考", updatedAt: now - 1000 * 60 * 60 * 10 },
    video(3),
    video(4),
    video(5)
  ];

  itemsByFolderId[fIncoming2026] = [video(6), video(7), video(8), video(9)];
  itemsByFolderId[fIncomingRef] = [video(10), video(11)];

  itemsByFolderId[fCuts] = [{ id: fCutsV1, kind: "folder", name: "v1", updatedAt: now - 1000 * 60 * 60 * 4 }, video(12)];
  itemsByFolderId[fCutsV1] = [video(13), video(14), video(15)];

  itemsByFolderId[fDelivery] = [video(16), video(17)];

  return { itemsByFolderId } satisfies MockDb;
}

export function sortItems(items: WorkspaceItem[], sort: SortMode) {
  const list = [...items];

  const folderFirst = (a: WorkspaceItem, b: WorkspaceItem) => {
    const af = a.kind === "folder";
    const bf = b.kind === "folder";
    if (af !== bf) return af ? -1 : 1;
    return 0;
  };

  list.sort((a, b) => {
    const ff = folderFirst(a, b);
    if (ff !== 0) return ff;

    if (sort === "updated_desc") return b.updatedAt - a.updatedAt;
    if (sort === "name_desc") return b.name.localeCompare(a.name, "zh-CN");
    return a.name.localeCompare(b.name, "zh-CN");
  });

  return list;
}

export function filterItems(items: WorkspaceItem[], q: string) {
  const query = q.trim().toLowerCase();
  if (!query) return items;
  return items.filter((i) => i.name.toLowerCase().includes(query));
}

export function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  const fixed = u === 0 ? 0 : n >= 10 ? 1 : 2;
  return `${n.toFixed(fixed)} ${units[u]}`;
}

export function formatDuration(seconds?: number) {
  if (!seconds && seconds !== 0) return "-";
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
