import { useReducer } from "react";
import { emptyHistory, reduceHistory } from "./history-stack";

export function useMarkupHistory<T>() {
  const [state, dispatch] = useReducer(reduceHistory<T>, undefined, emptyHistory<T>);
  return {
    operations: state.present,
    append: (value: T) => dispatch({ type: "append", value }),
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
    clear: () => dispatch({ type: "clear" }),
    reset: () => dispatch({ type: "reset" }),
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    dirty: state.present.length > 0 || state.past.length > 0 || state.future.length > 0
  };
}
