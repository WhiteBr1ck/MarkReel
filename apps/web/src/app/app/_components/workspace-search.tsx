"use client";

import { memo, useEffect, useRef, useState } from "react";
import { IconSearch } from "./icons";

export const WorkspaceSearch = memo(function WorkspaceSearch({ query, scope, onQuery }: { query: string; scope: "workspace" | "trash"; onQuery: (value: string) => void }) {
  const [draft, setDraft] = useState(query);
  const submitted = useRef(query);
  useEffect(() => {
    if (query !== submitted.current) setDraft(query);
    submitted.current = query;
  }, [query]);
  useEffect(() => {
    if (draft === query) return;
    const timer = window.setTimeout(() => {
      submitted.current = draft;
      onQuery(draft);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [draft, query, onQuery]);

  return <div className="mr-workbench-search">
    <IconSearch size={16} />
    <input aria-label="搜索" placeholder={scope === "trash" ? "搜索回收站…" : "搜索当前项目…"} value={draft} onChange={(event) => setDraft(event.target.value)} />
  </div>;
});
