"use client";

import { EDITORIAL_MODES, EditorialMode } from "@/convex/lib/prompts";

type SuggestionDiffProps = {
  mode: EditorialMode;
  originalText: string;
  suggestedText: string;
  onApply: () => void;
  onReject: () => void;
};

/**
 * Side-by-side comparison of current text and an AI suggestion.
 *
 * Intentionally plain-text for now — no inline diff highlighting.
 * The component contract (mode + original + suggested + callbacks)
 * supports future upgrades (token-level diffs, partial accept) without
 * structural changes.
 */
export function SuggestionDiff({
  mode,
  originalText,
  suggestedText,
  onApply,
  onReject,
}: SuggestionDiffProps) {
  const modeConfig = EDITORIAL_MODES[mode];

  return (
    <div className="border border-purple-200 rounded-lg overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="bg-purple-50 px-4 py-3 flex items-center justify-between border-b border-purple-200">
        <div>
          <span className="text-sm font-semibold text-purple-700">
            {modeConfig.label} Edit Suggestion
          </span>
          <span className="ml-2 text-xs text-purple-500">
            {modeConfig.description}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onApply}
            className="px-3 py-1.5 bg-purple-600 text-white rounded-md text-sm font-medium hover:bg-purple-700 transition-colors"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={onReject}
            className="px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Reject
          </button>
        </div>
      </div>

      {/* ── Two-column comparison ──────────────────────────────────── */}
      <div className="grid grid-cols-2 divide-x divide-purple-200">
        <div className="p-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
            Current
          </p>
          <div className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-gray-700">
            {originalText}
          </div>
        </div>

        <div className="p-4 bg-purple-50/30">
          <p className="text-xs font-medium text-purple-500 uppercase tracking-wider mb-3">
            Suggested
          </p>
          <div className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-gray-800">
            {suggestedText}
          </div>
        </div>
      </div>
    </div>
  );
}
