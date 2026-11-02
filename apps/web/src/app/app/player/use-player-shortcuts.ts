import { useEffect, useRef } from "react";
import { playerShortcut } from "./player-shortcuts";

type Shortcut = NonNullable<ReturnType<typeof playerShortcut>>;
export function usePlayerShortcuts(options: { blocked: boolean; onShortcut: (action: Shortcut, event: KeyboardEvent) => boolean; onRightRelease: (event: KeyboardEvent) => void }) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (latest.current.blocked) return;
      const target = event.target instanceof Element ? event.target : null;
      const editable = Boolean(target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='slider']"));
      const action = playerShortcut(event, editable);
      if (!action || (action === "play" && target?.closest("button, a, [role='button']"))) return;
      if (latest.current.onShortcut(action, event)) event.preventDefault();
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.key === "ArrowRight") latest.current.onRightRelease(event);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);
}
