"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type SavePayload = {
  title: string;
  body: string;
};

export type UseAutosaveOptions = {
  onSave: (payload: SavePayload) => Promise<void>;
  debounceMs?: number;
};

export function useAutosave({
  onSave,
  debounceMs = 600,
}: UseAutosaveOptions) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<SavePayload | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  const save = useCallback(
    async (payload: SavePayload) => {
      if (savingRef.current) {
        pendingRef.current = payload;
        return;
      }
      savingRef.current = true;
      setStatus("saving");
      try {
        await onSave(payload);
        setStatus("saved");
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setStatus("idle"), 2000);
      } catch {
        setStatus("error");
      } finally {
        savingRef.current = false;
        const next = pendingRef.current;
        pendingRef.current = null;
        if (next !== null) {
          save(next);
        }
      }
    },
    [onSave]
  );

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, []);

  const scheduleSave = useCallback(
    (payload: SavePayload) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        save(payload);
      }, debounceMs);
    },
    [save, debounceMs]
  );

  return { status, scheduleSave, save };
}
