"use client";

import { useMemo } from "react";
import type { DiffResult } from "@/lib/diffUtils";
import type { Hunk } from "@/lib/diffHunks";

// ── Props ──────────────────────────────────────────────────────────────────

type DiffHighlightViewProps = {
  result: DiffResult | null;
  computing: boolean;
  hunks: Hunk[];
  enabledHunks: ReadonlySet<number>;
  onToggleHunk: (id: number) => void;
  showRemovals: boolean;
  onToggleRemovals: () => void;
  /** Fallback text shown while computing or on error. */
  suggestedText: string;
};

// ── Component ──────────────────────────────────────────────────────────────

/**
 * Pure rendering component for hunk-aware diff highlighting.
 *
 * Each hunk is numbered with a clickable chip. Clicking either the chip
 * or the highlighted change region toggles that hunk on/off.
 * When a hunk is OFF, its additions disappear and removals show as
 * plain text (the original wording).
 */
export function DiffHighlightView({
  result,
  computing,
  hunks,
  enabledHunks,
  onToggleHunk,
  showRemovals,
  onToggleRemovals,
  suggestedText,
}: DiffHighlightViewProps) {
  // Build a fast lookup: changeIndex → hunkId
  const changeToHunk = useMemo(() => {
    const map = new Map<number, number>();
    for (const h of hunks) {
      for (const idx of h.changeIndices) {
        map.set(idx, h.id);
      }
    }
    return map;
  }, [hunks]);

  // Build the first-index set for chip placement
  const firstIndexOfHunk = useMemo(() => {
    const set = new Set<number>();
    for (const h of hunks) {
      if (h.changeIndices.length > 0) set.add(h.changeIndices[0]);
    }
    return set;
  }, [hunks]);

  const content = useMemo(() => {
    if (!result) return null;

    return result.changes.map((c, i) => {
      const hunkId = changeToHunk.get(i);

      // ── Unchanged token ──────────────────────────────────────────
      if (hunkId === undefined) {
        return <span key={i}>{c.value}</span>;
      }

      const enabled = enabledHunks.has(hunkId);

      // ── Chip before first change in a hunk ───────────────────────
      const chip = firstIndexOfHunk.has(i) ? (
        <HunkChip
          key={`chip-${hunkId}`}
          hunkId={hunkId}
          enabled={enabled}
          onClick={onToggleHunk}
        />
      ) : null;

      // ── Added token ──────────────────────────────────────────────
      if (c.added) {
        if (!enabled) {
          // Hunk disabled → skip the addition (revert to original)
          return chip ?? null;
        }
        return (
          <span key={i}>
            {chip}
            <span
              role="button"
              tabIndex={-1}
              onClick={() => onToggleHunk(hunkId)}
              className="bg-gray-200/80 rounded-sm px-0.5 cursor-pointer hover:bg-gray-300/70 transition-colors"
              style={{ boxDecorationBreak: "clone" }}
            >
              {c.value}
            </span>
          </span>
        );
      }

      // ── Removed token ────────────────────────────────────────────
      if (c.removed) {
        if (!enabled) {
          // Hunk disabled → show original text as plain
          return (
            <span key={i}>
              {chip}
              <span
                role="button"
                tabIndex={-1}
                onClick={() => onToggleHunk(hunkId)}
                className="cursor-pointer"
              >
                {c.value}
              </span>
            </span>
          );
        }
        // Hunk enabled → hide by default, strikethrough if showRemovals
        if (!showRemovals) return chip ?? null;
        return (
          <span key={i}>
            {chip}
            <span
              role="button"
              tabIndex={-1}
              onClick={() => onToggleHunk(hunkId)}
              className="line-through text-gray-400 bg-gray-100/60 rounded-sm px-0.5 cursor-pointer"
            >
              {c.value}
            </span>
          </span>
        );
      }

      return <span key={i}>{c.value}</span>;
    });
  }, [result, changeToHunk, firstIndexOfHunk, enabledHunks, onToggleHunk, showRemovals]);

  // ── Loading / fallback ───────────────────────────────────────────────
  if (computing) {
    return (
      <div className="text-sm text-gray-500 italic py-2">Computing diff…</div>
    );
  }

  if (!result) {
    return (
      <div className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-gray-800">
        {suggestedText}
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────
  return (
    <div>
      <ChangeSummary
        result={result}
        hunks={hunks}
        enabledHunks={enabledHunks}
        showRemovals={showRemovals}
        onToggleRemovals={onToggleRemovals}
      />
      <div className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-gray-800">
        {content}
      </div>
    </div>
  );
}

// ── Hunk chip ──────────────────────────────────────────────────────────────

function HunkChip({
  hunkId,
  enabled,
  onClick,
}: {
  hunkId: number;
  enabled: boolean;
  onClick: (id: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(hunkId);
      }}
      className={[
        "inline-flex items-center justify-center",
        "w-4 h-4 text-[10px] font-semibold leading-none rounded-full",
        "mr-0.5 align-text-top select-none transition-colors",
        enabled
          ? "bg-gray-800 text-white"
          : "bg-gray-200 text-gray-500 ring-1 ring-gray-300",
      ].join(" ")}
      title={enabled ? `Change ${hunkId + 1} — click to disable` : `Change ${hunkId + 1} — click to enable`}
    >
      {hunkId + 1}
    </button>
  );
}

// ── Original-side diff pane (left side of side-by-side) ────────────────────

type OriginalDiffPaneProps = {
  result: DiffResult | null;
  computing: boolean;
  hunks: Hunk[];
  enabledHunks: ReadonlySet<number>;
  onToggleHunk: (id: number) => void;
  originalText: string;
};

/**
 * Renders the *original* text with removals highlighted.
 * Additions never appear here (they don't exist in the original).
 *
 * - Hunk ON  → removed text shown with strikethrough + muted bg
 *              (indicating it will be cut).
 * - Hunk OFF → removed text shown as normal (the removal is reverted).
 */
export function OriginalDiffPane({
  result,
  computing,
  hunks,
  enabledHunks,
  onToggleHunk,
  originalText,
}: OriginalDiffPaneProps) {
  const changeToHunk = useMemo(() => {
    const map = new Map<number, number>();
    for (const h of hunks) {
      for (const idx of h.changeIndices) {
        map.set(idx, h.id);
      }
    }
    return map;
  }, [hunks]);

  const content = useMemo(() => {
    if (!result) return null;

    return result.changes.map((c, i) => {
      const hunkId = changeToHunk.get(i);

      // Unchanged token — always show
      if (hunkId === undefined) {
        return <span key={i}>{c.value}</span>;
      }

      const enabled = enabledHunks.has(hunkId);

      // Added token — never appears in the original side
      if (c.added) return null;

      // Removed token
      if (c.removed) {
        if (enabled) {
          // Hunk enabled → this text IS being removed: show with strikethrough + muted
          return (
            <span
              key={i}
              role="button"
              tabIndex={-1}
              onClick={() => onToggleHunk(hunkId)}
              className="line-through text-gray-400 bg-gray-200/50 rounded-sm px-0.5 cursor-pointer hover:bg-gray-200/80 transition-colors"
            >
              {c.value}
            </span>
          );
        }
        // Hunk disabled → removal reverted, show as normal text
        return <span key={i}>{c.value}</span>;
      }

      return <span key={i}>{c.value}</span>;
    });
  }, [result, changeToHunk, enabledHunks, onToggleHunk]);

  if (computing) {
    return (
      <div className="text-sm text-gray-500 italic py-2">Computing diff…</div>
    );
  }

  if (!result) {
    return (
      <div className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-gray-700">
        {originalText}
      </div>
    );
  }

  return (
    <div className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-gray-700">
      {content}
    </div>
  );
}

// ── Change summary ─────────────────────────────────────────────────────────

type ChangeSummaryProps = {
  result: DiffResult;
  hunks: Hunk[];
  enabledHunks: ReadonlySet<number>;
  showRemovals: boolean;
  onToggleRemovals: () => void;
};

export function ChangeSummary({
  result,
  hunks,
  enabledHunks,
  showRemovals,
  onToggleRemovals,
}: ChangeSummaryProps) {
  const { addedCount, removedCount, label } = result;
  const total = addedCount + removedCount;
  if (total === 0) return null;

  const enabledCount = hunks.filter((h) => enabledHunks.has(h.id)).length;

  const parts: string[] = [];
  if (addedCount > 0) parts.push(`~${addedCount} words added`);
  if (removedCount > 0) parts.push(`~${removedCount} removed`);

  return (
    <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500 mb-2">
      <span>{parts.join(", ")}</span>
      {label && (
        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
          Mainly {label}
        </span>
      )}
      {hunks.length > 1 && (
        <span className="text-gray-400">
          {enabledCount}/{hunks.length} changes enabled
        </span>
      )}
      {removedCount > 0 && (
        <button
          type="button"
          onClick={onToggleRemovals}
          className="text-gray-500 hover:text-gray-700 hover:underline"
        >
          {showRemovals ? "Hide removals" : "Show removals"}
        </button>
      )}
    </div>
  );
}
