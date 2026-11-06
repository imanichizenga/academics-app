"use client";
import { useSyncExternalStore } from "react";

/** A tiny external store, for state that outlives the component that started it (the upload queue). */
export function create<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(update: (s: T) => T) { state = update(state); listeners.forEach((l) => l()); },
    use(): T {
      return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => initial);
    },
  };
}
