"use client";

import type { DragEvent, MouseEvent } from "react";
import { memo, useMemo } from "react";
import type { Project } from "./shell";
import { IconGrip, IconMore } from "./icons";

type Props = {
  projects: Project[];
  title: string;
  emptyLabel: string;
  activeId: string | null;
  dragId: string | null;
  dragOverId: string | null;
  onOpen: (id: string) => void;
  onMenu: (event: MouseEvent<HTMLButtonElement>, project: Project) => void;
  onDragStart: (id: string, event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (id: string, event: DragEvent<HTMLDivElement>) => void;
  onDrop: (id: string, groupIds: string[], event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
};

export const WorkspaceProjectList = memo(function WorkspaceProjectList(props: Props) {
  const groupIds = useMemo(() => props.projects.map((project) => project.id), [props.projects]);
  return <div className="mr-side-section">
    <div className="mr-side-section__title">{props.title}</div>
    {props.projects.length === 0 ? <div className="mr-project-list-empty">{props.emptyLabel}</div> : <div className="mr-project-list-rows">
      {props.projects.map((project) => <div
        key={project.id}
        className={`mr-project-row${project.id === props.activeId ? " mr-project-row--active" : ""}${project.id === props.dragId ? " mr-project-row--dragging" : ""}${project.id === props.dragOverId && project.id !== props.dragId ? " mr-project-row--drag-over" : ""}`}
        draggable
        onDragStart={(event) => props.onDragStart(project.id, event)}
        onDragOver={(event) => props.onDragOver(project.id, event)}
        onDrop={(event) => props.onDrop(project.id, groupIds, event)}
        onDragEnd={props.onDragEnd}
      >
        <div className="mr-project-row__grip" title="拖动排序" aria-hidden="true"><IconGrip size={16} /></div>
        <button type="button" className="mr-project-row__main" onClick={() => props.onOpen(project.id)} title={project.name}><span className="mr-project-row__name">{project.name}</span></button>
        <button type="button" className="mr-project-row__menu" aria-label={`项目菜单：${project.name}`} title={`项目菜单：${project.name}`} onClick={(event) => props.onMenu(event, project)}><IconMore /></button>
      </div>)}
    </div>}
  </div>;
});
