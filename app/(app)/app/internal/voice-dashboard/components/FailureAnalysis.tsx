"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const MODES = ["all", "developmental", "line", "copy"] as const;

export function FailureAnalysis() {
  const breakdown = useQuery(api.voiceCalibration.getFailureBreakdown);

  if (!breakdown) {
    return <p className="text-sm text-gray-400">Loading failure analysis…</p>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Failure Dimension Analysis</h2>

      <div className="grid grid-cols-2 gap-4">
        {MODES.map((mode) => {
          const data = breakdown[mode];
          if (!data || data.failed === 0) {
            return (
              <div
                key={mode}
                className="rounded-lg border border-gray-200 p-4"
              >
                <h3 className="text-sm font-semibold capitalize mb-2">
                  {mode === "all" ? "All Modes" : mode}
                </h3>
                <p className="text-xs text-gray-400">
                  {data?.enforced === 0
                    ? "No enforced evaluations"
                    : "No failures recorded"}
                </p>
              </div>
            );
          }

          return (
            <div
              key={mode}
              className="rounded-lg border border-gray-200 p-4 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold capitalize">
                  {mode === "all" ? "All Modes" : mode}
                </h3>
                <span className="text-xs text-gray-400">
                  {data.failed}/{data.enforced} failed (
                  {((data.failed / data.enforced) * 100).toFixed(1)}%)
                </span>
              </div>

              <div className="space-y-2">
                <DimensionBar
                  label="Semantic only"
                  count={data.semanticOnly}
                  total={data.failed}
                  color="bg-purple-400"
                />
                <DimensionBar
                  label="Stylistic only"
                  count={data.stylisticOnly}
                  total={data.failed}
                  color="bg-orange-400"
                />
                <DimensionBar
                  label="Scope only"
                  count={data.scopeOnly}
                  total={data.failed}
                  color="bg-cyan-400"
                />
                <DimensionBar
                  label="Combined only"
                  count={data.combinedOnly}
                  total={data.failed}
                  color="bg-gray-400"
                />
                <DimensionBar
                  label="Multi-dimension"
                  count={data.multiDimension}
                  total={data.failed}
                  color="bg-red-400"
                />
              </div>

              <div className="border-t border-gray-100 pt-3">
                <p className="text-[10px] text-gray-500 font-medium mb-1.5 uppercase tracking-wide">
                  Total appearances in failures
                </p>
                <div className="flex gap-3 text-xs">
                  <span>
                    <span className="inline-block w-2 h-2 rounded-full bg-purple-400 mr-1" />
                    Semantic: {data.semanticTotal}
                  </span>
                  <span>
                    <span className="inline-block w-2 h-2 rounded-full bg-orange-400 mr-1" />
                    Stylistic: {data.stylisticTotal}
                  </span>
                  <span>
                    <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 mr-1" />
                    Scope: {data.scopeTotal}
                  </span>
                </div>
              </div>

              {Object.keys(data.failurePatterns).length > 0 && (
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-[10px] text-gray-500 font-medium mb-1.5 uppercase tracking-wide">
                    Failure patterns
                  </p>
                  <div className="space-y-1">
                    {Object.entries(data.failurePatterns)
                      .sort((a, b) => b[1] - a[1])
                      .map(([pattern, count]) => (
                        <div
                          key={pattern}
                          className="flex items-center justify-between text-xs"
                        >
                          <code className="text-gray-600">{pattern}</code>
                          <span className="tabular-nums text-gray-500">
                            {count} (
                            {((count / data.failed) * 100).toFixed(0)}%)
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DimensionBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-gray-600 w-28">{label}</span>
      <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-gray-500 w-16 text-right">
        {count} ({pct.toFixed(0)}%)
      </span>
    </div>
  );
}
