"use client";

import { useMemo, useState, useEffect, useRef } from "react";
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
  /** Used to reset highlight fade on new suggestions. */
  suggestionIndex: number;
};

// ── Component ──────────────────────────────────────────────────────────────

/**
 * Pure rendering component for hunk-aware diff highlighting.
 *
 * A4.3 visual rules:
 * - Additions: soft green underline (not background block)
 * - Removals: light red strikethrough
 * - Highlights fade to 60% opacity after 3 seconds
 * - On hover, highlights return to 100%
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
  suggestionIndex,
}: DiffHighlightViewProps) {
  // A4.3: Track when highlights should begin fading
  const [highlightsFaded, setHighlightsFaded] = useState(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset fade timer whenever suggestion changes
  useEffect(() => {
    setHighlightsFaded(false);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => setHighlightsFaded(true), 3000);
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, [suggestionIndex]);

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

  // A4.3: Fade class for diff highlights
  const fadeClass = highlightsFaded
    ? "opacity-60 hover:opacity-100 transition-opacity duration-150"
    : "";

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
        // A4.3: Soft green underline instead of background block
        return (
          <span key={i}>
            {chip}
            <span
              role="button"
              tabIndex={-1}
              onClick={() => onToggleHunk(hunkId)}
              className={`underline decoration-emerald-400/70 decoration-1 underline-offset-2 cursor-pointer hover:decoration-emerald-500 transition-colors ${fadeClass}`}
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
        // Hunk enabled → hide by default, light red strikethrough if showRemovals
        if (!showRemovals) return chip ?? null;
        // A4.3: Light red strikethrough instead of harsh bg
        return (
          <span key={i}>
            {chip}
            <span
              role="button"
              tabIndex={-1}
              onClick={() => onToggleHunk(hunkId)}
              className={`line-through decoration-red-300/70 text-gray-400 cursor-pointer hover:text-gray-500 transition-colors ${fadeClass}`}
            >
              {c.value}
            </span>
          </span>
        );
      }

      return <span key={i}>{c.value}</span>;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, changeToHunk, firstIndexOfHunk, enabledHunks, onToggleHunk, showRemovals, fadeClass]);

  // ── Loading / fallback ───────────────────────────────────────────────
  if (computing) {
    return (
      <div className="space-y-2.5 py-2">
        <div className="h-3 rounded animate-shimmer w-full" />
        <div className="h-3 rounded animate-shimmer w-10/12" />
        <div className="h-3 rounded animate-shimmer w-11/12" />
      </div>
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
      {/* A4.3: Trust signal badge — fades after a few seconds */}
      <TrustBadge result={result} suggestionIndex={suggestionIndex} />
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
        "mr-0.5 align-text-top select-none btn-micro",
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
 * A4.3: Light red strikethrough for enabled removals (text being cut).
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
          // Hunk enabled → this text IS being removed: light red strikethrough
          return (
            <span
              key={i}
              role="button"
              tabIndex={-1}
              onClick={() => onToggleHunk(hunkId)}
              className="line-through decoration-red-300/70 text-gray-400 cursor-pointer hover:text-gray-500 transition-colors"
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
      <div className="space-y-2.5 py-2">
        <div className="h-3 rounded animate-shimmer w-full" />
        <div className="h-3 rounded animate-shimmer w-10/12" />
        <div className="h-3 rounded animate-shimmer w-11/12" />
      </div>
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

// ── Change summary (editorial tone) ─────────────────────────────────────────

type ChangeSummaryProps = {
  result: DiffResult;
  hunks: Hunk[];
  enabledHunks: ReadonlySet<number>;
  showRemovals: boolean;
  onToggleRemovals: () => void;
};

/**
 * A4.3: Editorial-tone change summary.
 * e.g. "12 words tightened · cadence preserved"
 * No emojis. No checkmarks. Just quiet clarity.
 */
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

  // A4.3: Editorial-tone summary
  const summaryText = buildEditorialSummary(addedCount, removedCount, label);

  return (
    <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500 mb-2">
      <span>{summaryText}</span>
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

/** Build an editorial-tone change summary string. */
function buildEditorialSummary(
  addedCount: number,
  removedCount: number,
  label: DiffResult["label"]
): string {
  const netChange = addedCount - removedCount;
  const totalChanged = Math.max(addedCount, removedCount);

  if (label === "tightened") {
    return `${Math.abs(netChange)} words tightened · structure preserved`;
  }
  if (label === "expanded") {
    return `${netChange} words added · clarity improved`;
  }
  if (label === "rephrased") {
    return `${totalChanged} words rephrased · voice preserved`;
  }

  // Fallback
  const parts: string[] = [];
  if (addedCount > 0) parts.push(`${addedCount} added`);
  if (removedCount > 0) parts.push(`${removedCount} removed`);
  return parts.join(", ");
}

// ── Trust badge ─────────────────────────────────────────────────────────────

function TrustBadge({
  result,
  suggestionIndex,
}: {
  result: DiffResult;
  suggestionIndex: number;
}) {
  const [visible, setVisible] = useState(true);

  // Reset visibility on new suggestion
  useEffect(() => {
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(timer);
  }, [suggestionIndex]);

  if (!visible || !result.label) return null;

  const message =
    result.label === "rephrased"
      ? "Voice preserved"
      : result.label === "tightened"
        ? "Meaning preserved"
        : result.label === "expanded"
          ? "Intent preserved"
          : null;

  if (!message) return null;

  return (
    <div className="mt-2 animate-trust-badge">
      <span className="text-[11px] text-gray-400">
        {message} ✓
      </span>
    </div>
  );
}
