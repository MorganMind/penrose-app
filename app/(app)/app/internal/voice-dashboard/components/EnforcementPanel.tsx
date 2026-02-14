"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatScore } from "../lib/analysisUtils";

const CLASS_STYLES: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  pass: {
    bg: "bg-green-100 dark:bg-green-900/30",
    text: "text-green-800 dark:text-green-400",
    label: "Pass",
  },
  soft_warning: {
    bg: "bg-amber-100 dark:bg-amber-900/30",
    text: "text-amber-800 dark:text-amber-400",
    label: "Soft Warning",
  },
  failure: {
    bg: "bg-red-100 dark:bg-red-900/30",
    text: "text-red-800 dark:text-red-400",
    label: "Failure",
  },
  drift: {
    bg: "bg-purple-100 dark:bg-purple-900/30",
    text: "text-purple-800 dark:text-purple-400",
    label: "Drift",
  },
};

const OUTCOME_STYLES: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  pass: {
    bg: "bg-green-100 dark:bg-green-900/30",
    text: "text-green-800 dark:text-green-400",
    label: "Pass (no retry needed)",
  },
  soft_warning_resolved: {
    bg: "bg-emerald-100 dark:bg-emerald-900/30",
    text: "text-emerald-800 dark:text-emerald-400",
    label: "Soft Warning → Resolved",
  },
  failure_resolved: {
    bg: "bg-emerald-100 dark:bg-emerald-900/30",
    text: "text-emerald-800 dark:text-emerald-400",
    label: "Failure → Resolved",
  },
  drift_resolved: {
    bg: "bg-emerald-100 dark:bg-emerald-900/30",
    text: "text-emerald-800 dark:text-emerald-400",
    label: "Drift → Resolved",
  },
  original_returned: {
    bg: "bg-red-100 dark:bg-red-900/30",
    text: "text-red-800 dark:text-red-400",
    label: "Original Returned",
  },
};

export function EnforcementPanel() {
  const stats = useQuery(api.voiceAnalytics.getEnforcementStats);
  const timeline = useQuery(api.voiceAnalytics.getEnforcementTimeline, {
    limit: 50,
  });

  if (!stats) return <Loading />;

  return (
    <div className="space-y-6">
      {/* ── Summary cards ──────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="Total runs" value={stats.total} />
        <MetricCard
          label="Pass rate"
          value={`${((stats.byClass.pass?.pct ?? 0) * 100).toFixed(1)}%`}
          subtext={`${stats.byClass.pass?.count ?? 0} runs`}
          good
        />
        <MetricCard
          label="Retry rate"
          value={`${(stats.retryRate * 100).toFixed(1)}%`}
          subtext="of total runs triggered enforcement"
        />
        <MetricCard
          label="Original return rate"
          value={`${(stats.originalReturnRate * 100).toFixed(1)}%`}
          subtext="all candidates failed"
          bad={stats.originalReturnRate > 0.15}
        />
      </div>

      {/* ── Enforcement class distribution ─────────────────── */}
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
        <h4 className="mb-3 text-sm font-semibold">
          Initial classification distribution
        </h4>
        <div className="flex gap-2">
          {(["pass", "soft_warning", "failure", "drift"] as const).map(
            (cls) => {
              const data = stats.byClass[cls];
              if (!data || data.count === 0) return null;
              const style = CLASS_STYLES[cls];
              const widthPct = (data.pct * 100).toFixed(0);

              return (
                <div
                  key={cls}
                  className={`flex-none rounded px-3 py-2 ${style.bg}`}
                  style={{ width: `${Math.max(12, data.pct * 100)}%` }}
                >
                  <p className={`text-xs font-semibold ${style.text}`}>
                    {style.label}
                  </p>
                  <p className={`text-lg font-bold tabular-nums ${style.text}`}>
                    {data.count}
                  </p>
                  <p className="text-xs text-zinc-500">{widthPct}%</p>
                </div>
              );
            }
          )}
        </div>
      </div>

      {/* ── Outcome distribution ───────────────────────────── */}
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
        <h4 className="mb-3 text-sm font-semibold">Terminal outcomes</h4>
        <div className="grid grid-cols-5 gap-3">
          {Object.entries(OUTCOME_STYLES).map(([key, style]) => {
            const data = stats.byOutcome[key];
            return (
              <div key={key} className={`rounded p-3 ${style.bg}`}>
                <p className={`text-xs font-medium ${style.text}`}>
                  {style.label}
                </p>
                <p
                  className={`mt-1 text-xl font-bold tabular-nums ${style.text}`}
                >
                  {data?.count ?? 0}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Retry effectiveness ────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
          <h4 className="mb-2 text-sm font-semibold">Retry success rate</h4>
          <p className="text-3xl font-bold tabular-nums">
            <span
              className={
                stats.retrySuccessRate > 0.5
                  ? "text-green-600 dark:text-green-400"
                  : stats.retrySuccessRate > 0.2
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-red-600 dark:text-red-400"
              }
            >
              {(stats.retrySuccessRate * 100).toFixed(1)}%
            </span>
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Of runs that retried, this % produced a passing candidate
          </p>
        </div>

        {stats.scoreImprovement && (
          <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
            <h4 className="mb-2 text-sm font-semibold">
              Combined score change after retry
            </h4>
            <div className="grid grid-cols-3 gap-3 text-xs tabular-nums">
              <div>
                <p className="text-zinc-500">Average</p>
                <p
                  className={`text-sm font-semibold ${
                    stats.scoreImprovement.avg > 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-500"
                  }`}
                >
                  {stats.scoreImprovement.avg >= 0 ? "+" : ""}
                  {stats.scoreImprovement.avg.toFixed(4)}
                </p>
              </div>
              <div>
                <p className="text-zinc-500">Best</p>
                <p className="text-sm font-semibold text-green-600 dark:text-green-400">
                  +{stats.scoreImprovement.max.toFixed(4)}
                </p>
              </div>
              <div>
                <p className="text-zinc-500">Improved</p>
                <p className="text-sm font-semibold">
                  {stats.scoreImprovement.positiveCount}/
                  {stats.scoreImprovement.count}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Per-mode breakdown ─────────────────────────────── */}
      {Object.keys(stats.byMode).length > 0 && (
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
          <h4 className="mb-3 text-sm font-semibold">Per-mode breakdown</h4>
          <div className="grid grid-cols-2 gap-4">
            {Object.entries(stats.byMode).map(([mode, m]) => (
              <div
                key={mode}
                className="rounded border border-zinc-100 p-3 dark:border-zinc-800"
              >
                <p className="text-sm font-semibold capitalize">{mode}</p>
                <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
                  <ClassCount cls="pass" count={m.passCount} total={m.total} />
                  <ClassCount
                    cls="soft_warning"
                    count={m.softWarningCount}
                    total={m.total}
                  />
                  <ClassCount
                    cls="failure"
                    count={m.failureCount}
                    total={m.total}
                  />
                  <ClassCount
                    cls="drift"
                    count={m.driftCount}
                    total={m.total}
                  />
                </div>
                <div className="mt-2 flex gap-4 text-xs text-zinc-500">
                  <span>
                    Retry: {m.retryCount}/{m.total} (
                    {((m.retryCount / m.total) * 100).toFixed(0)}%)
                  </span>
                  <span>
                    Original returned: {m.originalReturnCount}/{m.total}
                  </span>
                  {m.retryCount > 0 && (
                    <span>
                      Retry success: {(m.retrySuccessRate * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Timeline ───────────────────────────────────────── */}
      {timeline && timeline.length > 0 && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
            <h4 className="text-sm font-semibold">
              Recent enforcement timeline
            </h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-zinc-500 dark:border-zinc-700">
                  <th className="py-2 pl-4 pr-3 font-medium">Time</th>
                  <th className="py-2 pr-3 font-medium">Mode</th>
                  <th className="py-2 pr-3 font-medium">Class</th>
                  <th className="py-2 pr-3 font-medium">Outcome</th>
                  <th className="py-2 pr-3 font-medium">Initial combined</th>
                  <th className="py-2 pr-3 font-medium">Initial semantic</th>
                  <th className="py-2 pr-3 font-medium">Final combined</th>
                  <th className="py-2 pr-3 font-medium">Δ combined</th>
                  <th className="py-2 pr-3 font-medium">Candidates</th>
                  <th className="py-2 pr-3 font-medium">Model</th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((r) => {
                  const delta =
                    r.finalBestCombinedScore !== undefined &&
                    r.initialBestCombinedScore !== undefined
                      ? r.finalBestCombinedScore -
                        r.initialBestCombinedScore
                      : null;

                  return (
                    <tr
                      key={r._id}
                      className="border-b border-zinc-100 dark:border-zinc-800"
                    >
                      <td className="whitespace-nowrap py-1.5 pl-4 pr-3 tabular-nums">
                        {new Date(r.createdAt).toLocaleString()}
                      </td>
                      <td className="py-1.5 pr-3 capitalize">
                        {r.editorialMode}
                      </td>
                      <td className="py-1.5 pr-3">
                        <ClassBadge cls={r.enforcementClass ?? "pass"} />
                      </td>
                      <td className="py-1.5 pr-3">
                        <OutcomeBadge
                          outcome={r.enforcementOutcome ?? "pass"}
                        />
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {r.initialBestCombinedScore !== undefined
                          ? formatScore(r.initialBestCombinedScore)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {r.initialBestSemanticScore !== undefined
                          ? formatScore(r.initialBestSemanticScore)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {r.finalBestCombinedScore !== undefined
                          ? formatScore(r.finalBestCombinedScore)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {delta !== null ? (
                          <span
                            className={
                              delta > 0.001
                                ? "text-green-600 dark:text-green-400"
                                : delta < -0.001
                                  ? "text-red-500"
                                  : "text-zinc-400"
                            }
                          >
                            {delta >= 0 ? "+" : ""}
                            {delta.toFixed(4)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {r.candidateCount}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-zinc-500">
                        {r.model}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  subtext,
  good,
  bad,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  good?: boolean;
  bad?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-700">
      <p className="text-xs text-zinc-500">{label}</p>
      <p
        className={`text-2xl font-bold tabular-nums ${
          good
            ? "text-green-600 dark:text-green-400"
            : bad
              ? "text-red-600 dark:text-red-400"
              : ""
        }`}
      >
        {value}
      </p>
      {subtext && (
        <p className="mt-0.5 text-xs text-zinc-400">{subtext}</p>
      )}
    </div>
  );
}

function ClassBadge({ cls }: { cls: string }) {
  const style = CLASS_STYLES[cls] ?? {
    bg: "bg-zinc-100",
    text: "text-zinc-600",
    label: cls,
  };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
    >
      {style.label}
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const style = OUTCOME_STYLES[outcome] ?? {
    bg: "bg-zinc-100",
    text: "text-zinc-600",
    label: outcome,
  };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
    >
      {style.label}
    </span>
  );
}

function ClassCount({
  cls,
  count,
  total,
}: {
  cls: string;
  count: number;
  total: number;
}) {
  const style = CLASS_STYLES[cls];
  if (!style) return null;
  return (
    <div className={`rounded p-1.5 text-center ${style.bg}`}>
      <p className={`text-xs ${style.text}`}>{style.label}</p>
      <p className={`font-bold tabular-nums ${style.text}`}>{count}</p>
      <p className="text-zinc-400">
        {total > 0 ? ((count / total) * 100).toFixed(0) : 0}%
      </p>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-12 text-sm text-zinc-400">
      Loading enforcement data…
    </div>
  );
}
