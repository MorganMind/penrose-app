"use client";

import type { SaveStatus } from "./useAutosave";

type SaveIndicatorProps = {
  status: SaveStatus;
  className?: string;
};

export function SaveIndicator({ status, className = "" }: SaveIndicatorProps) {
  if (status === "idle") return null;

  const text =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : status === "error"
          ? "Save failed"
          : "";

  return (
    <span
      className={`text-xs text-gray-400 ${className}`}
      aria-live="polite"
    >
      {text}
    </span>
  );
}
