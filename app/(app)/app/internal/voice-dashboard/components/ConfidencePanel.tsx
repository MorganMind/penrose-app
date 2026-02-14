"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const BAND_STYLES = {
  low: {
    bg: "bg-red-100 dark:bg-red-900/30",
    text: "text-red-800 dark:text-red-400",
    bar: "bg-red-400",
  },
  medium: {
    bg: "bg-amber-100 dark:bg-amber-900/30",
    text: "text-amber-800 dark:text-amber-400",
    bar: "bg-amber-400",
  },
  high: {
    bg: "bg-green-100 dark:bg-green-900/30",
    text: "text-green-800 dark:text-green-400",
    bar: "bg-green-400",
  },
} as const;

export function ConfidencePanel() {
  const data = useQuery(api.voiceAnalytics.getConfidenceOverview);

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-zinc-400">
        Loading confidence data…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Band distribution ──────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="Total profiles" value={data.totalProfiles} />
        {(["low", "medium", "high"] as const).map((band) => {
          const style = BAND_STYLES[band];
          return (
            <div
              key={band}
              className={`rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-700 ${style.bg}`}
            >
              <p className={`text-xs capitalize ${style.text}`}>{band}</p>
              <p className={`text-2xl font-bold tabular-nums ${style.text}`}>
                {data.bandCounts[band]}
              </p>
            </div>
          );
        })}
      </div>

      {/* ── Evaluation impact by confidence band ───────────── */}
      {Object.keys(data.evalsByBand).length > 0 && (
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
          <h4 className="mb-3 text-sm font-semibold">
            Score impact by confidence band
          </h4>
          <p className="mb-3 text-xs text-zinc-500">
            How confidence modulation affects actual evaluation scores. At low
            confidence, stylistic penalties are dampened and semantic
            preservation is weighted more heavily.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="border-b text-left text-zinc-500 dark:border-zinc-700">
                  <th className="pb-2 pr-4 font-medium">Band</th>
                  <th className="pb-2 pr-4 font-medium">Evaluations</th>
                  <th className="pb-2 pr-4 font-medium">Avg semantic</th>
                  <th className="pb-2 pr-4 font-medium">Avg stylistic</th>
                  <th className="pb-2 pr-4 font-medium">Avg combined</th>
                  <th className="pb-2 font-medium">Pass rate</th>
                </tr>
              </thead>
              <tbody>
                {(["none", "low", "medium", "high"] as const).map((band) => {
                  const metrics = data.evalsByBand[band];
                  if (!metrics) return null;
                  const bandStyle =
                    band === "none"
                      ? { text: "text-zinc-500", bg: "" }
                      : BAND_STYLES[band];

                  return (
                    <tr
                      key={band}
                      className="border-b border-zinc-100 dark:border-zinc-800"
                    >
                      <td className="py-1.5 pr-4">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium capitalize ${bandStyle.bg} ${bandStyle.text}`}
                        >
                          {band === "none" ? "No profile" : band}
                        </span>
                      </td>
                      <td className="py-1.5 pr-4">{metrics.count}</td>
                      <td className="py-1.5 pr-4">
                        {metrics.avgSemantic.toFixed(3)}
                      </td>
                      <td className="py-1.5 pr-4">
                        {metrics.avgStylistic.toFixed(3)}
                      </td>
                      <td className="py-1.5 pr-4 font-medium">
                        {metrics.avgCombined.toFixed(3)}
                      </td>
                      <td className="py-1.5">
                        {(metrics.passRate * 100).toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Per-profile detail ─────────────────────────────── */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
        <div className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
          <h4 className="text-sm font-semibold">Profile details</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-zinc-500 dark:border-zinc-700">
                <th className="py-2 pl-4 pr-3 font-medium">User</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Confidence</th>
                <th className="py-2 pr-3 font-medium">Band</th>
                <th className="py-2 pr-3 font-medium">Words</th>
                <th className="py-2 pr-3 font-medium">Samples</th>
                <th className="py-2 pr-3 font-medium">Word conf</th>
                <th className="py-2 pr-3 font-medium">Sample conf</th>
                <th className="py-2 pr-3 font-medium">Diversity</th>
                <th className="py-2 pr-3 font-medium">Temporal</th>
                <th className="py-2 pr-3 font-medium">Sources</th>
                <th className="py-2 font-medium">Posts</th>
              </tr>
            </thead>
            <tbody>
              {data.profileDetails.map((p) => {
                const style =
                  BAND_STYLES[p.confidenceBand as keyof typeof BAND_STYLES];
                return (
                  <tr
                    key={p._id}
                    className="border-b border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="py-1.5 pl-4 pr-3 font-mono text-zinc-500">
                      {p.userId.slice(-6)}
                    </td>
                    <td className="py-1.5 pr-3 capitalize">{p.status}</td>
                    <td className="py-1.5 pr-3">
                      <ConfidenceBar value={p.confidence} />
                    </td>
                    <td className="py-1.5 pr-3">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium capitalize ${style.bg} ${style.text}`}
                      >
                        {p.confidenceBand}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {p.totalWordCount.toLocaleString()}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {p.sampleCount}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {p.components.wordConfidence.toFixed(3)}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {p.components.sampleConfidence.toFixed(3)}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {p.components.diversityScore.toFixed(3)}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {p.components.temporalSpread.toFixed(3)}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {p.uniqueSourceTypes}/4
                    </td>
                    <td className="py-1.5 tabular-nums">
                      {p.uniquePostIds}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Modulation explainer ───────────────────────────── */}
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
        <h4 className="mb-2 text-sm font-semibold">
          How confidence modulates enforcement
        </h4>
        <div className="grid grid-cols-3 gap-4 text-xs">
          <ModulationCard
            band="low"
            confidence="< 0.40"
            stylistic="Stylistic thresholds at 75% — lenient on style"
            semantic="Semantic thresholds at 108% — strict on meaning"
            weights="Semantic weight +25%, stylistic weight -30%"
            features="Feature penalties dampened by 40%"
          />
          <ModulationCard
            band="medium"
            confidence="0.40 – 0.70"
            stylistic="Linear interpolation toward full thresholds"
            semantic="Linear interpolation toward base thresholds"
            weights="Gradual return to base mode weights"
            features="Feature penalties gradually restored"
          />
          <ModulationCard
            band="high"
            confidence="≥ 0.70"
            stylistic="Full stylistic thresholds apply"
            semantic="Base semantic thresholds apply"
            weights="Base mode weights apply"
            features="Full feature penalties"
          />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-700">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    value < 0.4
      ? "bg-red-400"
      : value < 0.7
        ? "bg-amber-400"
        : "bg-green-400";

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="tabular-nums">{value.toFixed(3)}</span>
    </div>
  );
}

function ModulationCard({
  band,
  confidence,
  stylistic,
  semantic,
  weights,
  features,
}: {
  band: string;
  confidence: string;
  stylistic: string;
  semantic: string;
  weights: string;
  features: string;
}) {
  const style = BAND_STYLES[band as keyof typeof BAND_STYLES];
  return (
    <div
      className={`rounded-lg border p-3 ${style?.bg ?? "bg-zinc-50 dark:bg-zinc-800"}`}
    >
      <p className={`font-semibold capitalize ${style?.text ?? ""}`}>
        {band}{" "}
        <span className="font-normal text-zinc-500">({confidence})</span>
      </p>
      <ul className="mt-2 space-y-1 text-zinc-600 dark:text-zinc-400">
        <li>• {stylistic}</li>
        <li>• {semantic}</li>
        <li>• {weights}</li>
        <li>• {features}</li>
      </ul>
    </div>
  );
}
