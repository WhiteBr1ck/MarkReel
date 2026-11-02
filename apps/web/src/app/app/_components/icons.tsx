import type { CSSProperties } from "react";
import {
  IconAdjustmentsHorizontal, IconArrowUp, IconBrightnessAuto, IconChecks,
  IconChevronRight, IconDots, IconFolder as Folder, IconFolderPlus,
  IconGripVertical, IconInfoCircle, IconLayoutGrid, IconList as List,
  IconMoon as Moon, IconPencil, IconPlus as Plus, IconSearch as Search,
  IconSortDescending, IconSun as Sun, IconTrash, IconUpload as Upload,
  IconVideo as Video
} from "@tabler/icons-react";

type IconProps = { size?: number; style?: CSSProperties };

function icon(Component: typeof Folder) {
  return function InterfaceIcon({ size = 18, style }: IconProps) {
    return <Component size={size} stroke={1.5} aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }} />;
  };
}

export const IconGrid = icon(IconLayoutGrid);
export const IconList = icon(List);
export const IconSearch = icon(Search);
export const IconAutoTheme = icon(IconBrightnessAuto);
export const IconSun = icon(Sun);
export const IconMoon = icon(Moon);
export const IconInfo = icon(IconInfoCircle);
export const IconSettings = icon(IconAdjustmentsHorizontal);
export const IconVideo = icon(Video);
export const IconFolder = icon(Folder);
export const IconUpload = icon(Upload);
export const IconPlus = icon(Plus);
export const IconSort = icon(IconSortDescending);
export const IconUp = icon(IconArrowUp);
export const IconNewFolder = icon(IconFolderPlus);
export const IconRename = icon(IconPencil);
export const IconDelete = icon(IconTrash);
export const IconSelect = icon(IconChecks);
export const IconMore = icon(IconDots);
export const IconGrip = icon(IconGripVertical);

export function IconChevron({ size = 18, style, dir = "right" }: IconProps & { dir?: "right" | "left" | "down" }) {
  const rotation = dir === "down" ? "rotate(90deg)" : dir === "left" ? "rotate(180deg)" : "rotate(0deg)";
  return <IconChevronRight size={size} stroke={1.5} aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style, transform: `${rotation} ${style?.transform ?? ""}`.trim() }} />;
}
