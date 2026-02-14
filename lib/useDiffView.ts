"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "penrose-suggestion-diff-view";
const STORAGE_KEY_REMOVALS = "penrose-suggestion-show-removals";

export type DiffViewMode = "side-by-side" | "diff" | "clean";

const VALID_MODES: ReadonlySet<string> = new Set([
  "side-by-side",
  "diff",
  "clean",
]);

function loadViewMode(): DiffViewMode {
  if (typeof window === "undefined") return "side-by-side";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && VALID_MODES.has(v)) return v as DiffViewMode;
  } catch {
    /* ignore */
  }
  return "side-by-side";
}

function loadShowRemovals(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY_REMOVALS) === "true";
  } catch {
    return false;
  }
}

function persistViewMode(mode: DiffViewMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

function persistShowRemovals(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY_REMOVALS, String(value));
  } catch {
    /* ignore */
  }
}

export function useDiffView() {
  const [viewMode, setViewModeState] = useState<DiffViewMode>("side-by-side");
  const [showRemovals, setShowRemovalsState] = useState(false);

  // Hydrate from localStorage once on mount
  useEffect(() => {
    setViewModeState(loadViewMode());
    setShowRemovalsState(loadShowRemovals());
  }, []);

  const setViewMode = useCallback((mode: DiffViewMode) => {
    setViewModeState(mode);
    persistViewMode(mode);
  }, []);

  const setShowRemovals = useCallback((value: boolean) => {
    setShowRemovalsState(value);
    persistShowRemovals(value);
  }, []);

  // Stable references — no dependency on current state
  const toggleDiffMode = useCallback(() => {
    setViewModeState((prev) => {
      const next = prev === "diff" ? "side-by-side" : "diff";
      persistViewMode(next);
      return next;
    });
  }, []);

  const toggleShowRemovals = useCallback(() => {
    setShowRemovalsState((prev) => {
      const next = !prev;
      persistShowRemovals(next);
      return next;
    });
  }, []);

  return {
    viewMode,
    setViewMode,
    showRemovals,
    setShowRemovals,
    toggleDiffMode,
    toggleShowRemovals,
  };
}
