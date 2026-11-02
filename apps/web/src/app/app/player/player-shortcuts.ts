type Key = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "isComposing" | "keyCode" | "defaultPrevented">;

export function isComposingKey(event: Pick<Key, "isComposing" | "keyCode">) {
  return event.isComposing || event.keyCode === 229;
}

export function isSubmitKey(event: Key) {
  return !event.defaultPrevented && !isComposingKey(event) && !event.altKey && (event.ctrlKey || event.metaKey) && event.key === "Enter";
}

export function playerShortcut(event: Key, editable: boolean) {
  if (editable || event.defaultPrevented || isComposingKey(event) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (event.ctrlKey || event.metaKey) {
    if (key === "arrowleft") return "previousFrame";
    if (key === "arrowright") return "nextFrame";
    if (key === "z") return event.shiftKey ? "redo" : "undo";
    if (key === "y") return "redo";
    return null;
  }
  const actions = { " ": "play", arrowleft: "back", arrowright: "forward", f: "fullscreen", a: "annotate", m: "mute", escape: "escape" } as const;
  return actions[key as keyof typeof actions] ?? null;
}
