export type HistoryStack<T> = { past: T[][]; present: T[]; future: T[][] };
export type HistoryAction<T> = { type: "append"; value: T } | { type: "undo" | "redo" | "clear" | "reset" };

export function emptyHistory<T>(): HistoryStack<T> {
  return { past: [], present: [], future: [] };
}

export function reduceHistory<T>(state: HistoryStack<T>, action: HistoryAction<T>): HistoryStack<T> {
  if (action.type === "reset") return emptyHistory<T>();
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    return previous ? { past: state.past.slice(0, -1), present: previous, future: [...state.future, state.present] } : state;
  }
  if (action.type === "redo") {
    const next = state.future.at(-1);
    return next ? { past: [...state.past, state.present], present: next, future: state.future.slice(0, -1) } : state;
  }
  if (action.type === "clear" && state.present.length === 0) return state;
  return {
    past: [...state.past.slice(-99), state.present],
    present: action.type === "append" ? [...state.present, action.value] : [],
    future: []
  };
}
