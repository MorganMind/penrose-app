"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export function ModelDrift() {
  const stats = useQuery(api.voiceCalibration.getModelVersionStats);

  if (!stats) {
    return <p className="text-sm text-gray-400">Loading model stats…</p>;
  }

  if (stats.length === 0) {
    return (
      <p className="text-sm text-gray-400">No evaluations recorded yet.</p>
    );
  }

  // Detect regressions: compare each version to the previous (older) one
  const regressions: Array<{
    current: (typeof stats)[0];
    previous: (typeof stats)[0];
    delta: number;
  }> = [];
  for (let i = 0; i < stats.length - 1; i++) {
    const current = stats[i];
    const previous = stats[i + 1];
    const delta =
      current.scores.combined.mean - previous.scores.combined.mean;
    if (delta < -0.03) {
      regressions.push({ current, previous, delta });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">
          Model & Prompt Version Drift
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Compare score distributions across model and prompt versions to detect
          when changes affect voice fidelity.
        </p>
      </div>

      {regressions.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h4 className="text-sm font-semibold text-amber-800">
            Score regression detected
          </h4>
          {regressions.map((r, i) => (
            <p key={i} className="mt-1 text-xs text-amber-700">
              <code>{r.current.model}</code> (prompt{" "}
              <code>{r.current.promptVersion.slice(0, 8)}</code>) dropped{" "}
              <strong>{Math.abs(r.delta).toFixed(3)}</strong> vs previous
              version <code>{r.previous.model}</code> (prompt{" "}
              <code>{r.previous.promptVersion.slice(0, 8)}</code>)
            </p>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {stats.map((group) => {
          const groupKey = `${group.provider}::${group.model}::${group.promptVersion}`;

          return (
            <div
              key={groupKey}
              className="rounded-lg border border-gray-200 p-4"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{group.model}</span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono">
                      {group.promptVersion}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {group.provider} · {group.count} evaluations ·{" "}
                    {new Date(group.earliest).toLocaleDateString()} –{" "}
                    {new Date(group.latest).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold tabular-nums">
                    {(group.passRate * 100).toFixed(1)}%
                  </p>
                  <p className="text-[10px] text-gray-400">
                    pass rate ({group.enforced} enforced)
                  </p>
                </div>
              </div>

              <div className="flex gap-2 mb-4">
                {Object.entries(group.modes).map(([mode, count]) => (
                  <span
                    key={mode}
                    className="rounded bg-gray-100 px-2 py-0.5 text-[10px] capitalize"
                  >
                    {mode}: {count}
                  </span>
                ))}
              </div>

              <div className="grid grid-cols-4 gap-3">
                {(
                  ["semantic", "stylistic", "scope", "combined"] as const
                ).map((dim) => {
                  const s = group.scores[dim];
                  return (
                    <div
                      key={dim}
                      className="rounded border border-gray-100 p-2.5"
                    >
                      <p className="text-[10px] text-gray-500 font-medium capitalize mb-1">
                        {dim}
                      </p>
                      <p className="text-lg font-bold tabular-nums">
                        {s.mean.toFixed(3)}
                      </p>
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-[10px] text-gray-400">P25</span>
                        <span className="text-[10px] tabular-nums">
                          {s.p25.toFixed(3)}
                        </span>
                        <span className="text-[10px] text-gray-300">|</span>
                        <span className="text-[10px] text-gray-400">P50</span>
                        <span className="text-[10px] tabular-nums font-medium">
                          {s.p50.toFixed(3)}
                        </span>
                        <span className="text-[10px] text-gray-300">|</span>
                        <span className="text-[10px] text-gray-400">P75</span>
                        <span className="text-[10px] tabular-nums">
                          {s.p75.toFixed(3)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {stats.length > 1 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">
            Cross-Version Comparison
          </h3>
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500">
                  <th className="py-2 px-3">Model</th>
                  <th className="py-2 px-3">Prompt</th>
                  <th className="py-2 px-3">n</th>
                  <th className="py-2 px-3">Pass %</th>
                  <th className="py-2 px-3">Semantic μ</th>
                  <th className="py-2 px-3">Stylistic μ</th>
                  <th className="py-2 px-3">Scope μ</th>
                  <th className="py-2 px-3">Combined μ</th>
                  <th className="py-2 px-3">Period</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((g) => (
                  <tr
                    key={`${g.model}-${g.promptVersion}`}
                    className="border-b border-gray-100"
                  >
                    <td className="py-1.5 px-3 font-medium">{g.model}</td>
                    <td className="py-1.5 px-3 font-mono text-gray-500">
                      {g.promptVersion}
                    </td>
                    <td className="py-1.5 px-3 tabular-nums">{g.count}</td>
                    <td className="py-1.5 px-3 tabular-nums font-medium">
                      {(g.passRate * 100).toFixed(1)}%
                    </td>
                    <td className="py-1.5 px-3 tabular-nums">
                      {g.scores.semantic.mean.toFixed(3)}
                    </td>
                    <td className="py-1.5 px-3 tabular-nums">
                      {g.scores.stylistic.mean.toFixed(3)}
                    </td>
                    <td className="py-1.5 px-3 tabular-nums">
                      {g.scores.scope.mean.toFixed(3)}
                    </td>
                    <td className="py-1.5 px-3 tabular-nums">
                      {g.scores.combined.mean.toFixed(3)}
                    </td>
                    <td className="py-1.5 px-3 text-gray-400">
                      {new Date(g.earliest).toLocaleDateString()} –{" "}
                      {new Date(g.latest).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
