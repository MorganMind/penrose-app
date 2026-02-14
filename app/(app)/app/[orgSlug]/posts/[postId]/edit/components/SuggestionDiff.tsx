"use client";

import { useEffect, useCallback, useMemo, useState } from "react";
import { EDITORIAL_MODES, EditorialMode } from "@/convex/lib/prompts";
import { Id } from "@/convex/_generated/dataModel";
import { ReactionPanel } from "./ReactionPanel";
import { NudgeBar } from "./NudgeBar";
import { NudgeDirection } from "@/convex/lib/nudges";
import { useDiffView, type DiffViewMode } from "@/lib/useDiffView";
import { useDiffComputation } from "@/lib/useDiffComputation";
import {
  applySelectedHunks,
  allHunksEnabled,
  allHunkIds,
} from "@/lib/diffHunks";
import { DiffHighlightView, OriginalDiffPane } from "./DiffHighlightView";

// ── Props ──────────────────────────────────────────────────────────────────

type SuggestionDiffProps = {
  mode: EditorialMode;
  originalText: string;
  suggestedText: string;
  provider: string;
  model: string;
  promptVersion: string;
  orgId: Id<"orgs">;
  postId: Id<"posts">;
  suggestionIndex: number;
  nudgeDirection?: string;
  hasAlternate?: boolean;
  /** Called with the final text to apply (selective or full). */
  onApply: (text: string) => void;
  onReject: () => void;
  onNudge: (direction: NudgeDirection) => void;
  onTryAgain?: () => void;
  isNudging: boolean;
  isTryingAgain?: boolean;
  nudgingDirection: NudgeDirection | null;
  /** True when the underlying draft body has changed since this suggestion was generated. */
  draftInvalidated: boolean;
};

const VIEW_LABELS: Record<DiffViewMode, string> = {
  "side-by-side": "Side-by-side",
  diff: "Diff Highlight",
  clean: "Clean",
};

/** Returns true if the keyboard event target is a text-entry element. */
function isTextInput(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement)?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

// ── Component ──────────────────────────────────────────────────────────────

export function SuggestionDiff({
  mode,
  originalText,
  suggestedText,
  provider,
  model,
  promptVersion,
  orgId,
  postId,
  suggestionIndex,
  nudgeDirection,
  hasAlternate,
  onApply,
  onReject,
  onNudge,
  onTryAgain,
  isNudging,
  isTryingAgain,
  nudgingDirection,
  draftInvalidated,
}: SuggestionDiffProps) {
  const modeConfig = EDITORIAL_MODES[mode];

  // ── Diff view state ────────────────────────────────────────────────────
  const {
    viewMode,
    setViewMode,
    showRemovals,
    toggleDiffMode,
    toggleShowRemovals,
  } = useDiffView();

  // ── Diff computation (always runs so selective-apply works in any mode)
  const { result, hunks, computing, error } = useDiffComputation(
    originalText,
    suggestedText
  );

  // ── Hunk toggle state — reset to all-ON on new suggestion ──────────────
  const [enabledHunks, setEnabledHunks] = useState<ReadonlySet<number>>(
    new Set<number>()
  );

  // Reset whenever the suggestion changes (try-again, nudge, new refinement)
  useEffect(() => {
    setEnabledHunks(allHunkIds(hunks));
  }, [hunks]);

  const toggleHunk = useCallback((id: number) => {
    setEnabledHunks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Selective apply text ───────────────────────────────────────────────
  const selectiveText = useMemo(() => {
    if (!result || hunks.length === 0) return suggestedText;
    // Fast path: if all hunks are enabled, use the original suggested text
    // to avoid any normalization artifacts from reconstruction.
    if (allHunksEnabled(hunks, enabledHunks)) return suggestedText;
    return applySelectedHunks(result.changes, hunks, enabledHunks);
  }, [result, hunks, enabledHunks, suggestedText]);

  const allEnabled = hunks.length > 0 && allHunksEnabled(hunks, enabledHunks);
  const noneEnabled =
    hunks.length > 0 && hunks.every((h) => !enabledHunks.has(h.id));

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleApply = useCallback(() => {
    onApply(selectiveText);
  }, [onApply, selectiveText]);

  // Fallback to side-by-side if diff computation fails
  const handleDiffError = useCallback(() => {
    if (error) setViewMode("side-by-side");
  }, [error, setViewMode]);

  useEffect(() => {
    if (error) handleDiffError();
  }, [error, handleDiffError]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isTextInput(e)) return;
        e.preventDefault();
        onReject();
        return;
      }

      if (
        (e.key === "d" || e.key === "D") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        if (!isTextInput(e)) {
          e.preventDefault();
          toggleDiffMode();
        }
        return;
      }

      if (
        (e.key === "r" || e.key === "R") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        if (!isTextInput(e)) {
          e.preventDefault();
          toggleShowRemovals();
        }
      }
    },
    [onReject, toggleDiffMode, toggleShowRemovals]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // ── Derived ────────────────────────────────────────────────────────────
  const applyDisabled = isNudging || draftInvalidated || noneEnabled;
  const applyLabel = allEnabled
    ? "Apply"
    : noneEnabled
      ? "Apply"
      : "Apply selected";

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-0">
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="bg-gray-50 px-4 py-3 flex items-center justify-between border-b border-gray-200">
          <div>
            <span className="text-sm font-semibold text-gray-800">
              {modeConfig.label} Edit Suggestion
            </span>
            <span className="ml-2 text-xs text-gray-500">
              {modeConfig.description}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleApply}
              disabled={applyDisabled}
              className="px-3 py-1.5 bg-gray-900 text-white rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {applyLabel}
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={isNudging}
              className="px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              Reject
            </button>
          </div>
        </div>

        {/* ── Draft invalidation warning ────────────────────────────── */}
        {draftInvalidated && (
          <div className="px-4 py-2.5 bg-orange-50 border-b border-orange-200 text-sm text-orange-800">
            Draft changed — rerun suggestions to apply selectively.
          </div>
        )}

        {/* ── Diff view toggle ─────────────────────────────────────── */}
        <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500 shrink-0">View:</span>
          {(Object.keys(VIEW_LABELS) as DiffViewMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setViewMode(m)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                viewMode === m
                  ? "border-gray-400 bg-gray-200 text-gray-800"
                  : "border-gray-300 text-gray-600 hover:bg-gray-100 hover:border-gray-400"
              }`}
            >
              {VIEW_LABELS[m]}
            </button>
          ))}
          <span className="text-xs text-gray-400 ml-1">
            (D: diff, R: removals, Esc: exit)
          </span>
        </div>

        {/* ── Comparison content ────────────────────────────────────── */}
        <ComparisonContent
          viewMode={viewMode}
          originalText={originalText}
          suggestedText={suggestedText}
          selectiveText={selectiveText}
          result={result}
          computing={computing}
          hunks={hunks}
          enabledHunks={enabledHunks}
          onToggleHunk={toggleHunk}
          showRemovals={showRemovals}
          toggleShowRemovals={toggleShowRemovals}
          allEnabled={allEnabled}
        />

        {/* ── Try again (swap) + Nudge bar ──────────────────────────── */}
        <div className="border-t border-gray-100 px-3 py-2 flex flex-wrap items-center gap-3">
          {onTryAgain && hasAlternate && (
            <button
              type="button"
              onClick={onTryAgain}
              disabled={isNudging || isTryingAgain}
              className="px-2.5 py-1 text-xs rounded-full border border-gray-300 text-gray-700 hover:bg-gray-100 hover:border-gray-400 disabled:opacity-50 transition-colors"
            >
              {isTryingAgain ? "…" : "Try again"}
            </button>
          )}
          <NudgeBar
            onNudge={onNudge}
            isRunning={isNudging || (isTryingAgain ?? false)}
            runningDirection={nudgingDirection}
          />
        </div>
      </div>

      {/* ── Reaction panel (outside card, non-blocking) ────────────── */}
      <ReactionPanel
        orgId={orgId}
        postId={postId}
        mode={mode}
        provider={provider}
        model={model}
        promptVersion={promptVersion}
        nudgeDirection={nudgeDirection}
        suggestionIndex={suggestionIndex}
      />
    </div>
  );
}

// ── Extracted comparison panel ──────────────────────────────────────────────

type ComparisonContentProps = {
  viewMode: DiffViewMode;
  originalText: string;
  suggestedText: string;
  selectiveText: string;
  result: import("@/lib/diffUtils").DiffResult | null;
  computing: boolean;
  hunks: import("@/lib/diffHunks").Hunk[];
  enabledHunks: ReadonlySet<number>;
  onToggleHunk: (id: number) => void;
  showRemovals: boolean;
  toggleShowRemovals: () => void;
  allEnabled: boolean;
};

function ComparisonContent({
  viewMode,
  originalText,
  suggestedText,
  selectiveText,
  result,
  computing,
  hunks,
  enabledHunks,
  onToggleHunk,
  showRemovals,
  toggleShowRemovals,
  allEnabled,
}: ComparisonContentProps) {
  if (viewMode === "side-by-side") {
    return (
      <div className="grid grid-cols-2 divide-x divide-gray-200">
        {/* ── Left: original with removals highlighted ──────────── */}
        <div className="p-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
            Current
          </p>
          <OriginalDiffPane
            result={result}
            computing={computing}
            hunks={hunks}
            enabledHunks={enabledHunks}
            onToggleHunk={onToggleHunk}
            originalText={originalText}
          />
        </div>

        {/* ── Right: suggested with additions highlighted + chips ─ */}
        <div className="p-4 bg-gray-50/50">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
            {allEnabled ? "Suggested" : "Preview (selective)"}
          </p>
          <DiffHighlightView
            result={result}
            computing={computing}
            hunks={hunks}
            enabledHunks={enabledHunks}
            onToggleHunk={onToggleHunk}
            showRemovals={showRemovals}
            onToggleRemovals={toggleShowRemovals}
            suggestedText={suggestedText}
          />
        </div>
      </div>
    );
  }

  if (viewMode === "diff") {
    return (
      <div className="p-4 bg-gray-50/50">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
          Suggested (with diff)
        </p>
        <DiffHighlightView
          result={result}
          computing={computing}
          hunks={hunks}
          enabledHunks={enabledHunks}
          onToggleHunk={onToggleHunk}
          showRemovals={showRemovals}
          onToggleRemovals={toggleShowRemovals}
          suggestedText={suggestedText}
        />
      </div>
    );
  }

  // clean
  return (
    <div className="p-4 bg-gray-50/50">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
        {allEnabled ? "Suggested" : "Preview (selective)"}
      </p>
      <div className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-gray-800">
        {selectiveText}
      </div>
    </div>
  );
}
