"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { api } from "./api";
import type { FolderNode, Project, WorkspaceItem } from "./shell";
import { createWorkspaceResource, workspaceKey } from "./workspace-resource";

export type WorkspaceResponse = {
  project: Project;
  activeFolderId: string;
  breadcrumbs: Array<{ id: string; name: string }>;
  folderTree: FolderNode;
  items: WorkspaceItem[];
};

export type TrashItem = Extract<WorkspaceItem, { kind: "video" }> & { deletedAt: number | null };
type ProjectsResponse = { projects: Project[] };
type TrashResponse = { items: TrashItem[] };
const EMPTY_PROJECTS: Project[] = [];
const EMPTY_TRASH: TrashItem[] = [];

function useResource<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>, enabled = true) {
  const resource = useMemo(() => createWorkspaceResource<T>(), [key]);
  const loader = useRef(load);
  useLayoutEffect(() => { loader.current = load; });
  const snapshot = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);

  useLayoutEffect(() => {
    resource.activate(key);
    return () => resource.clear();
  }, [resource, key]);

  useLayoutEffect(() => {
    if (enabled) void resource.refresh(key, (signal) => loader.current(signal), false);
  }, [resource, key, enabled]);

  const refresh = useCallback(() => resource.refresh(key, (signal) => loader.current(signal)), [resource, key]);
  const current = key !== null && snapshot.key === key;
  return {
    data: current ? snapshot.data : null,
    error: current ? snapshot.error : null,
    loading: key !== null && (current ? snapshot.loading || (enabled && !snapshot.data && !snapshot.error) : enabled),
    refresh,
    clear: resource.clear
  };
}

export function useWorkspaceData(userId: string | null, requestedProject: string | null, requestedFolder: string | null, scope: "workspace" | "trash") {
  const projects = useResource(workspaceKey(userId), (signal) => api<ProjectsResponse>("/projects", { signal }));
  const projectId = requestedProject ?? projects.data?.projects[0]?.id ?? null;
  const rootFid = projectId ? `root-${projectId}` : null;
  const folderId = requestedFolder ?? rootFid;
  const workspace = useResource(workspaceKey(userId, projectId, folderId), (signal) => {
    const query = new URLSearchParams({ folderId: folderId! });
    return api<WorkspaceResponse>(`/projects/${projectId}/workspace?${query}`, { signal });
  }, scope === "workspace");
  const trash = useResource(workspaceKey(userId, projectId), (signal) => api<TrashResponse>(`/projects/${projectId}/trash`, { signal }), scope === "trash");

  const refreshWorkspace = useCallback((targetProject = projectId, targetFolder = folderId) => {
    if (targetProject !== projectId || targetFolder !== folderId) return Promise.resolve(null);
    return workspace.refresh();
  }, [projectId, folderId, workspace.refresh]);
  const refreshTrash = useCallback((targetProject = projectId) => {
    if (targetProject !== projectId) return Promise.resolve(null);
    return trash.refresh();
  }, [projectId, trash.refresh]);
  const clear = useCallback(() => {
    projects.clear();
    workspace.clear();
    trash.clear();
  }, [projects.clear, workspace.clear, trash.clear]);

  return {
    effectivePid: projectId,
    effectiveFid: folderId,
    rootFid,
    workspaces: projects.data?.projects ?? EMPTY_PROJECTS,
    workspace: workspace.data,
    trashItems: trash.data?.items ?? EMPTY_TRASH,
    trashLoaded: trash.data !== null,
    projectsLoading: projects.loading,
    projectsError: projects.error,
    workspaceLoading: workspace.loading,
    workspaceError: workspace.error,
    trashLoading: trash.loading,
    trashError: trash.error,
    refreshWorkspaces: projects.refresh,
    refreshWorkspace,
    refreshTrash,
    clear
  };
}

// Event handlers stay referentially stable at memoized workspace boundaries.
export function useWorkspaceEvent<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const latest = useRef(callback);
  useLayoutEffect(() => { latest.current = callback; });
  return useCallback((...args: Args) => latest.current(...args), []);
}

export function useWorkspaceRequestGuard(scopeKey: string) {
  const guard = useMemo(() => ({ active: false, sequence: 0 }), [scopeKey]);
  useLayoutEffect(() => {
    guard.active = true;
    return () => { guard.active = false; guard.sequence += 1; };
  }, [guard]);
  return useCallback(() => {
    const sequence = ++guard.sequence;
    return () => guard.active && guard.sequence === sequence;
  }, [guard]);
}
