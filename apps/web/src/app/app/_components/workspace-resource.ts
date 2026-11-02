export type ResourceSnapshot<T> = {
  key: string | null;
  data: T | null;
  error: unknown;
  loading: boolean;
};

export function workspaceKey(...parts: Array<string | null>) {
  return parts.some((part) => part === null) ? null : JSON.stringify(parts);
}

// Abort saves work; the key and sequence check also protects against transports
// which finish after cancellation, including a session refresh retry.
export function createWorkspaceResource<T>() {
  let snapshot: ResourceSnapshot<T> = { key: null, data: null, error: null, loading: false };
  let sequence = 0;
  let controller: AbortController | null = null;
  let pending: Promise<T | null> | null = null;
  const listeners = new Set<() => void>();

  function publish(next: ResourceSnapshot<T>) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  function activate(key: string | null) {
    if (snapshot.key === key) return;
    sequence += 1;
    controller?.abort();
    controller = null;
    pending = null;
    publish({ key, data: null, error: null, loading: false });
  }

  function refresh(key: string | null, load: (signal: AbortSignal) => Promise<T>, force = true): Promise<T | null> {
    // A refresh callback retained by an upload or mutation belongs to its origin.
    if (key === null || snapshot.key !== key) return Promise.resolve(null);
    if (!force && pending) return pending;
    if (!force && snapshot.data !== null) return Promise.resolve(snapshot.data);
    controller?.abort();
    const requestController = new AbortController();
    controller = requestController;
    const requestSequence = ++sequence;
    const isCurrent = () => snapshot.key === key && sequence === requestSequence && !requestController.signal.aborted;
    publish({ ...snapshot, error: null, loading: true });
    pending = (async () => {
      try {
        const data = await Promise.resolve().then(() => isCurrent() ? load(requestController.signal) : null);
        if (!isCurrent()) return null;
        if (data === null) return null;
        publish({ key, data, error: null, loading: false });
        return data;
      } catch (error) {
        if (isCurrent()) publish({ key, data: null, error, loading: false });
        return null;
      } finally {
        if (isCurrent()) {
          controller = null;
          pending = null;
          if (snapshot.loading) publish({ ...snapshot, loading: false });
        }
      }
    })();
    return pending;
  }

  return {
    activate,
    refresh,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    clear() {
      activate(null);
    }
  };
}
