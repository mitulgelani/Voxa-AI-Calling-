'use client';
// Browser-local persistence for v1 (agents, contacts, call history).
// Every access is wrapped: storage can be missing, full, or throw in private windows.
import { useCallback, useEffect, useRef, useState } from 'react';

export function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStore<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or privacy mode: keep working in memory */
  }
}

/** useState that mirrors to localStorage. Hydrates after mount to keep SSR markup stable. */
export function useStored<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const valueRef = useRef(value);

  useEffect(() => {
    const stored = readStore<T>(key, initial);
    valueRef.current = stored;
    setValue(stored);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(valueRef.current) : next;
      valueRef.current = resolved;
      setValue(resolved);
      writeStore(key, resolved);
    },
    [key],
  );

  return [value, update, ready];
}

export function newId(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
