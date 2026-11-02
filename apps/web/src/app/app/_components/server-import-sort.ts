export type ServerImportEntry = {
  name: string;
  path: string;
  kind: "directory" | "file";
  sizeBytes?: number;
  updatedAt: number;
};

export type ServerImportSortKey = "name" | "type" | "size" | "updatedAt";
export type ServerImportSort = {
  key: ServerImportSortKey;
  direction: "asc" | "desc";
};

export const DEFAULT_SERVER_IMPORT_SORT: ServerImportSort = { key: "name", direction: "asc" };

const naturalNames = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

export function serverImportFileType(entry: ServerImportEntry) {
  if (entry.kind === "directory") return "";
  const dot = entry.name.lastIndexOf(".");
  return dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : "";
}

export function nextServerImportSort(current: ServerImportSort, key: ServerImportSortKey): ServerImportSort {
  return { key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" };
}

export function serverImportSizeBytes(entry: ServerImportEntry) {
  const size = entry.sizeBytes;
  return size !== undefined && Number.isFinite(size) && size >= 0 ? size : undefined;
}

export function serverImportModifiedTime(entry: ServerImportEntry) {
  const time = Number.isFinite(entry.updatedAt) ? new Date(entry.updatedAt).getTime() : NaN;
  return Number.isFinite(time) ? time : undefined;
}

function compareNumbers(a: number | undefined, b: number | undefined, direction: number) {
  const aKnown = a !== undefined && Number.isFinite(a);
  const bKnown = b !== undefined && Number.isFinite(b);
  if (!aKnown || !bKnown) return aKnown ? -1 : bKnown ? 1 : 0;
  return (a - b) * direction;
}

export function sortServerImportEntries(entries: readonly ServerImportEntry[], sort = DEFAULT_SERVER_IMPORT_SORT) {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    // Keep folders first even when the active column is descending.
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    let comparison = 0;
    if (sort.key === "type") {
      comparison = naturalNames.compare(serverImportFileType(a), serverImportFileType(b)) * direction;
    } else if (sort.key === "size") {
      comparison = compareNumbers(serverImportSizeBytes(a), serverImportSizeBytes(b), direction);
    } else if (sort.key === "updatedAt") {
      comparison = compareNumbers(serverImportModifiedTime(a), serverImportModifiedTime(b), direction);
    }
    return comparison || naturalNames.compare(a.name, b.name) * direction;
  });
}
