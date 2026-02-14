"use client";

import {
  NUDGE_DIRECTIONS,
  NudgeDirection,
  NUDGE_DIRECTION_KEYS,
} from "@/convex/lib/nudges";

type NudgeBarProps = {
  onNudge: (direction: NudgeDirection) => void;
  isRunning: boolean;
  runningDirection: NudgeDirection | null;
};

export function NudgeBar({
  onNudge,
  isRunning,
  runningDirection,
}: NudgeBarProps) {
  return (
    <div className="flex items-center gap-2 py-2 px-1 flex-wrap">
      <span className="text-xs text-gray-500 shrink-0">Try again:</span>
      {NUDGE_DIRECTION_KEYS.map((dir) => (
        <button
          key={dir}
          type="button"
          onClick={() => onNudge(dir)}
          disabled={isRunning}
          className="px-2.5 py-1 text-xs rounded-full border border-gray-300 text-gray-700 hover:bg-gray-100 hover:border-gray-400 disabled:opacity-50 transition-colors"
        >
          {runningDirection === dir ? "…" : NUDGE_DIRECTIONS[dir].label}
        </button>
      ))}
    </div>
  );
}
