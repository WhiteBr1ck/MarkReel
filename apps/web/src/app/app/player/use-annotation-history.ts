import { useEffect, useRef, useState } from "react";

export type AnnotationMutationResult = { id: string; historyToken?: string; updatedAt?: string };
type Entry = { id: string; historyToken: string };
type Options = {
  scope: string;
  request: (entry: Entry) => Promise<AnnotationMutationResult>;
  reload: () => Promise<unknown>;
  onError: (error: unknown) => void;
};

export function useAnnotationHistory(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const state = useRef({ scope: options.scope, undo: [] as Entry[], redo: [] as Entry[], busy: false });
  const [, render] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  if (state.current.scope !== options.scope) state.current = { scope: options.scope, undo: [], redo: [], busy: false };
  useEffect(() => setUnavailable(false), [options.scope]);

  async function mutate<T extends AnnotationMutationResult>(work: () => Promise<T>): Promise<T> {
    const current = state.current;
    if (current.busy) throw new Error("annotation_busy");
    current.busy = true;
    render((value) => value + 1);
    try {
      const result = await work();
      if (state.current !== current) return result;
      current.redo = [];
      if (result.historyToken) {
        current.undo = [...current.undo.slice(-49), { id: result.id, historyToken: result.historyToken }];
        setUnavailable(false);
      } else {
        current.undo = [];
        setUnavailable(true);
      }
      return result;
    } finally {
      current.busy = false;
      render((value) => value + 1);
    }
  }

  async function travel(direction: "undo" | "redo") {
    const current = state.current;
    const entry = current[direction].at(-1);
    if (!entry || current.busy) return;
    current.busy = true;
    render((value) => value + 1);
    try {
      const result = await latest.current.request(entry);
      if (state.current !== current) return;
      if (!result.historyToken) {
        current.undo = [];
        current.redo = [];
        setUnavailable(true);
        await latest.current.reload();
        return;
      }
      current[direction].pop();
      const opposite = direction === "undo" ? "redo" : "undo";
      current[opposite].push({ id: result.id, historyToken: result.historyToken });
      await latest.current.reload();
    } catch (error) {
      if (state.current === current) latest.current.onError(error);
    } finally {
      current.busy = false;
      render((value) => value + 1);
    }
  }

  return {
    mutate,
    undo: () => travel("undo"),
    redo: () => travel("redo"),
    canUndo: state.current.undo.length > 0,
    canRedo: state.current.redo.length > 0,
    busy: state.current.busy,
    unavailable
  };
}
