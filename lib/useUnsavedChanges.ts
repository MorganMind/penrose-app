"use client";

import { useEffect, useCallback } from "react";

/**
 * Guard against accidental data loss when the editor has unsaved changes.
 *
 * - Registers a `beforeunload` handler that triggers the browser's native
 *   "Leave site?" dialog on tab close, refresh, or external navigation.
 *
 * - Returns a `confirmLeave` helper that components can call before
 *   in-app navigation (e.g., the Back button) to show a confirm dialog.
 *
 * Modern browsers ignore custom `beforeunload` messages for security
 * reasons, but still show a generic prompt when `e.preventDefault()`
 * is called.
 */
export function useUnsavedChanges(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const confirmLeave = useCallback((): boolean => {
    if (!isDirty) return true;
    return window.confirm(
      "You have unsaved changes. Are you sure you want to leave?"
    );
  }, [isDirty]);

  return { confirmLeave };
}
