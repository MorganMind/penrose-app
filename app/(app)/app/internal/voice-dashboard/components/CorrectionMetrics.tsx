"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const TYPE_LABELS: Record<
  string,
  { label: string; description: string }
> = {
  constraint_boost: {
    label: "Constraint Boost",
    description:
      "Re-ran the edit with stricter voice safety constraints appended to the prompt",
  },
  minimal_edit: {
    label: "Minimal Edit",
    description:
      "Fell back to a single-change prompt that prioritizes voice preservation",
  },
  passthrough: {
    label: "Passthrough",
    description:
      "Neither correction improved the score — returned the best available suggestion",
  },
};

export function CorrectionMetrics() {
  const data = useQuery(api.voiceCalibration.getCorrectionEffectiveness);

  if (!data) {
    return <p className="text-sm text-gray-400">Loading correction data…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Correction Effectiveness</h2>
        <p className="text-sm text-gray-500 mt-1">
          How often the correction pipeline fires and whether retries actually
          improve voice fidelity scores.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Total evaluations"
          value={data.totalEvaluations.toString()}
        />
        <StatCard
          label="Corrections triggered"
          value={data.totalCorrected.toString()}
          subtext={`${(data.correctionRate * 100).toFixed(1)}% of all evals`}
        />
        <StatCard
          label="Overall improvement rate"
          value={`${(data.overall.improvementRate * 100).toFixed(1)}%`}
          subtext={`${data.overall.improved}/${data.overall.count} improved`}
        />
        <StatCard
          label="Avg improvement"
          value={
            data.overall.avgImprovement > 0
              ? `+${data.overall.avgImprovement.toFixed(4)}`
              : "—"
          }
          subtext={
            data.overall.maxImprovement > 0
              ? `max +${data.overall.maxImprovement.toFixed(4)}`
              : ""
          }
        />
      </div>

      <div className="space-y-4">
        {(["constraint_boost", "minimal_edit", "passthrough"] as const).map(
          (type) => {
            const stats = data.byType[type];
            const meta = TYPE_LABELS[type];

            return (
              <div
                key={type}
                className="rounded-lg border border-gray-200 p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold">{meta.label}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {meta.description}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400 tabular-nums">
                    {stats.count} occurrences
                  </span>
                </div>

                {stats.count === 0 ? (
                  <p className="text-xs text-gray-400">Not triggered yet.</p>
                ) : (
                  <div className="grid grid-cols-4 gap-4">
                    <MiniStat
                      label="Improvement rate"
                      value={`${(stats.improvementRate * 100).toFixed(1)}%`}
                    />
                    <MiniStat
                      label="Avg improvement"
                      value={
                        stats.avgImprovement > 0
                          ? `+${stats.avgImprovement.toFixed(4)}`
                          : "—"
                      }
                    />
                    <MiniStat
                      label="Avg initial score"
                      value={stats.avgInitialScore.toFixed(4)}
                    />
                    <MiniStat
                      label="Avg final score"
                      value={stats.avgFinalScore.toFixed(4)}
                    />
                  </div>
                )}

                {stats.improvementDeltas &&
                  stats.improvementDeltas.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-gray-500 mb-1">
                        Improvement distribution
                      </p>
                      <DeltaHistogram deltas={stats.improvementDeltas} />
                    </div>
                  )}

                {stats.count > 0 && (
                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden flex">
                      <div
                        className="h-full bg-green-400"
                        style={{
                          width: `${stats.improvementRate * 100}%`,
                        }}
                      />
                      <div
                        className="h-full bg-red-300"
                        style={{
                          width: `${(1 - stats.improvementRate) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 w-24">
                      {stats.improved} improved / {stats.notImproved} not
                    </span>
                  </div>
                )}
              </div>
            );
          }
        )}
      </div>

      {data.improvementPercentiles && (
        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold mb-2">
            Score improvement distribution (successful corrections)
          </h3>
          <div className="grid grid-cols-7 gap-3 text-xs tabular-nums">
            {[
              ["Min", data.improvementPercentiles.min],
              ["P10", data.improvementPercentiles.p10],
              ["P25", data.improvementPercentiles.p25],
              ["Median", data.improvementPercentiles.p50],
              ["P75", data.improvementPercentiles.p75],
              ["P90", data.improvementPercentiles.p90],
              ["Max", data.improvementPercentiles.max],
            ].map(([label, val]) => (
              <div key={label as string} className="text-center">
                <p className="text-gray-500">{label as string}</p>
                <p
                  className={`font-medium ${
                    (val as number) > 0
                      ? "text-green-600"
                      : (val as number) < 0
                        ? "text-red-500"
                        : ""
                  }`}
                >
                  {(val as number) >= 0 ? "+" : ""}
                  {(val as number).toFixed(4)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.totalCorrected > 0 && (
        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold mb-3">
            Correction Pipeline Flow
          </h3>
          <div className="flex items-center gap-2 text-xs">
            <PipelineStep
              label="Failures"
              count={data.totalCorrected}
              color="bg-red-100 text-red-800"
            />
            <Arrow />
            <PipelineStep
              label="Constraint boost"
              count={data.byType.constraint_boost.count}
              subcount={data.byType.constraint_boost.improved}
              color="bg-blue-100 text-blue-800"
            />
            <Arrow />
            <PipelineStep
              label="Minimal edit"
              count={data.byType.minimal_edit.count}
              subcount={data.byType.minimal_edit.improved}
              color="bg-amber-100 text-amber-800"
            />
            <Arrow />
            <PipelineStep
              label="Passthrough"
              count={data.byType.passthrough.count}
              color="bg-gray-100 text-gray-800"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  subtext,
}: {
  label: string;
  value: string;
  subtext?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-bold tabular-nums mt-1">{value}</p>
      {subtext && (
        <p className="text-[10px] text-gray-400 mt-0.5">{subtext}</p>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-gray-500">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function PipelineStep({
  label,
  count,
  subcount,
  color,
}: {
  label: string;
  count: number;
  subcount?: number;
  color: string;
}) {
  return (
    <div className={`rounded px-3 py-2 ${color} text-center`}>
      <p className="font-medium">{label}</p>
      <p className="text-lg font-bold tabular-nums">{count}</p>
      {subcount !== undefined && (
        <p className="text-[10px] opacity-75">{subcount} fixed</p>
      )}
    </div>
  );
}

function Arrow() {
  return <span className="text-gray-300 text-lg">→</span>;
}

function DeltaHistogram({ deltas }: { deltas: number[] }) {
  const sorted = [...deltas].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const range = max - min || 0.01;
  const bucketCount = 8;
  const bucketWidth = range / bucketCount;

  const buckets = Array(bucketCount).fill(0);
  for (const d of sorted) {
    const idx = Math.min(
      bucketCount - 1,
      Math.floor((d - min) / bucketWidth)
    );
    buckets[idx]++;
  }
  const maxBucket = Math.max(...buckets, 1);

  return (
    <div className="flex items-end gap-px h-8">
      {buckets.map((count, i) => {
        const height = (count / maxBucket) * 100;
        const bucketMid = min + (i + 0.5) * bucketWidth;
        return (
          <div
            key={i}
            className={`flex-1 rounded-t-sm ${
              bucketMid >= 0 ? "bg-green-300" : "bg-red-300"
            }`}
            style={{ height: `${Math.max(2, height)}%` }}
            title={`${(min + i * bucketWidth).toFixed(3)}–${(min + (i + 1) * bucketWidth).toFixed(3)}: ${count}`}
          />
        );
      })}
    </div>
  );
}
