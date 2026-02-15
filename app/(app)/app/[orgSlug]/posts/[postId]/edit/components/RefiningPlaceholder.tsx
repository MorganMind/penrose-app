"use client";

import { EditorialMode, EDITORIAL_MODES } from "@/convex/lib/prompts";

type RefiningPlaceholderProps = {
  mode: EditorialMode;
  /** The current body text — stays visible during refinement. */
  bodyText: string;
  /** Called when user clicks Dismiss while refining. */
  onDismiss?: () => void;
};

/**
 * Shown the instant a refinement is triggered.
 *
 * Matches the SuggestionDiff card layout exactly — same header, same
 * border, same structure — so the transition from "loading" to "loaded"
 * feels like the same card filling in, not two different screens.
 *
 * The original text stays visible inside the card, slightly dimmed.
 */
export function RefiningPlaceholder({ mode, bodyText, onDismiss }: RefiningPlaceholderProps) {
  const config = EDITORIAL_MODES[mode];

  return (
    <div className="animate-card-enter space-y-0">
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        {/* ── Header — matches SuggestionDiff exactly ──────────── */}
        <div className="bg-gray-50 px-4 py-3 flex items-center justify-between border-b border-gray-200">
          <div className="flex items-center gap-2">
            {/* Pen icon with wiggle — same as SuggestionDiff isRunning state */}
            <span className="inline-block text-gray-400">
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{
                  animation: "pen-wiggle 2.4s ease-in-out infinite",
                  transformOrigin: "2px 14px",
                }}
              >
                <path
                  d="M11.5 1.5L14.5 4.5L5 14H2V11L11.5 1.5Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M9.5 3.5L12.5 6.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <div>
              <span className="text-sm font-semibold text-gray-800">
                {config.label} Edit
              </span>
              <span className="ml-2 text-xs text-gray-500">
                Refining…
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            {/* Disabled Apply — matches SuggestionDiff button style */}
            <button
              type="button"
              disabled
              className="btn-micro px-3 py-1.5 bg-gray-900 text-white rounded-md text-sm font-medium disabled:opacity-50"
            >
              Apply
            </button>
            {/* Dismiss — lets user cancel out of the refinement */}
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="btn-micro px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-md text-sm font-medium hover:bg-gray-50"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>

        {/* ── Body: original text visible, dimmed, with shimmer ── */}
        <div className="relative">
          {/* Subtle progress shimmer bar at top edge */}
          <div className="absolute top-0 left-0 right-0 h-0.5 animate-shimmer z-10" />
          <div className="p-4">
            <div className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-gray-400">
              {bodyText}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
