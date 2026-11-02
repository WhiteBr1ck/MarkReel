import type { SortMode, WorkspaceItem } from "./shell";

export const WORKSPACE_PAGE_SIZE = 100;
const nameCollator = new Intl.Collator("zh-CN");

export function selectWorkspaceItems(items: WorkspaceItem[], query: string, sort: SortMode) {
  const keyword = query.trim().toLowerCase();
  const next = keyword ? items.filter((item) => item.name.toLowerCase().includes(keyword)) : [...items];
  return next.sort(sort === "updated_desc"
    ? (a, b) => b.updatedAt - a.updatedAt
    : (a, b) => nameCollator.compare(a.name, b.name) * (sort === "name_desc" ? -1 : 1));
}

export function workspacePage(items: WorkspaceItem[], requestedPage: number) {
  const pages = Math.max(1, Math.ceil(items.length / WORKSPACE_PAGE_SIZE));
  const page = Math.max(0, Math.min(pages - 1, requestedPage));
  return { page, pages, items: items.slice(page * WORKSPACE_PAGE_SIZE, (page + 1) * WORKSPACE_PAGE_SIZE) };
}
