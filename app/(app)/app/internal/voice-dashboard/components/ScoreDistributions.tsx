"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState } from "react";

const MODES = ["all", "developmental", "line", "copy"] as const;
const DIMENSIONS = ["semantic", "stylistic", "scope", "combined"] as const;

const DIMENSION_COLORS: Record<string, string> = {
  semantic: "bg-purple-500",
  stylistic: "bg-orange-500",
  scope: "bg-cyan-500",
  combined: "bg-gray-500",
};

export function ScoreDistributions({
  dateFrom,
  dateTo,
}: {
  dateFrom?: number;
  dateTo?: number;
} = {}) {
  const [includeUnenforced, setIncludeUnenforced] = useState(false);
  const distributions = useQuery(
    api.voiceCalibration.getScoreDistributions,
    { includeUnenforced, dateFrom, dateTo }
  );

  if (!distributions) {
    return <p className="text-sm text-gray-400">Loading distributions…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Score Distributions</h2>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          <input
            type="checkbox"
            checked={includeUnenforced}
            onChange={(e) => setIncludeUnenforced(e.target.checked)}
            className="rounded"
          />
          Include unenforced evaluations
        </label>
      </div>

      {MODES.map((mode) => {
        const modeData = distributions[mode];
        if (!modeData) return null;
        const anyData = Object.values(modeData).some((d) => d.count > 0);
        if (!anyData) return null;

        return (
          <div
            key={mode}
            className="rounded-lg border border-gray-200 p-4"
          >
            <h3 className="text-sm font-semibold capitalize mb-4">
              {mode === "all" ? "All Modes Combined" : mode}
            </h3>

            <div className="grid grid-cols-4 gap-4">
              {DIMENSIONS.map((dim) => {
                const d = modeData[dim];
                if (!d || d.count === 0) {
                  return (
                    <div key={dim} className="text-xs text-gray-400">
                      {dim}: no data
                    </div>
                  );
                }

                return (
                  <div key={dim} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-2 h-2 rounded-full ${DIMENSION_COLORS[dim]}`}
                      />
                      <span className="text-xs font-medium capitalize">
                        {dim}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        n={d.count}
                      </span>
                    </div>

                    <BoxPlot
                      min={d.min}
                      p10={d.p10}
                      p25={d.p25}
                      p50={d.p50}
                      p75={d.p75}
                      p90={d.p90}
                      max={d.max}
                      color={DIMENSION_COLORS[dim]}
                    />

                    <table className="w-full text-[10px]">
                      <tbody>
                        {[
                          ["P10", d.p10],
                          ["P25", d.p25],
                          ["P50 (median)", d.p50],
                          ["P75", d.p75],
                          ["P90", d.p90],
                          ["Mean", d.mean],
                          ["Std dev", d.stddev],
                          ["Min", d.min],
                          ["Max", d.max],
                        ].map(([label, val]) => (
                          <tr
                            key={label as string}
                            className="border-b border-gray-100"
                          >
                            <td className="py-0.5 text-gray-500">
                              {label as string}
                            </td>
                            <td className="py-0.5 text-right tabular-nums">
                              {(val as number).toFixed(4)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BoxPlot({
  min,
  p10,
  p25,
  p50,
  p75,
  p90,
  max,
  color,
}: {
  min: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  max: number;
  color: string;
}) {
  const scale = (v: number) => Math.max(0, Math.min(100, v * 100));

  return (
    <div className="relative h-6 w-full">
      <div className="absolute inset-y-2 left-0 right-0 bg-gray-100 rounded-full" />
      <div
        className="absolute top-2.5 h-1 bg-gray-300"
        style={{
          left: `${scale(p10)}%`,
          width: `${scale(p90) - scale(p10)}%`,
        }}
      />
      <div
        className={`absolute top-1 h-4 rounded opacity-30 ${color}`}
        style={{
          left: `${scale(p25)}%`,
          width: `${Math.max(1, scale(p75) - scale(p25))}%`,
        }}
      />
      <div
        className={`absolute top-0.5 h-5 w-0.5 ${color}`}
        style={{ left: `${scale(p50)}%` }}
      />
    </div>
  );
}
