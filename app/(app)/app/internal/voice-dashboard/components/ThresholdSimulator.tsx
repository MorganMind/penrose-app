"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useMemo } from "react";
import {
  simulateThresholds,
  type ScoreTuple,
  type SimulationThresholds,
} from "../lib/analysisUtils";

type EditorialMode = "developmental" | "line" | "copy";

const CURRENT_THRESHOLDS: Record<
  EditorialMode,
  { semantic: number; stylistic: number; scope: number; combined: number }
> = {
  copy: { semantic: 0.8, stylistic: 0.65, scope: 0.7, combined: 0.72 },
  line: { semantic: 0.75, stylistic: 0.6, scope: 0.6, combined: 0.68 },
  developmental: {
    semantic: 0.7,
    stylistic: 0.55,
    scope: 0.5,
    combined: 0.62,
  },
};

export function ThresholdSimulator({
  dateFrom,
  dateTo,
}: {
  dateFrom?: number;
  dateTo?: number;
} = {}) {
  const [mode, setMode] = useState<EditorialMode>("line");
  const current = CURRENT_THRESHOLDS[mode];

  const [semantic, setSemantic] = useState(current.semantic);
  const [stylistic, setStylistic] = useState(current.stylistic);
  const [scope, setScope] = useState(current.scope);
  const [combined, setCombined] = useState(current.combined);

  const handleModeChange = (m: EditorialMode) => {
    setMode(m);
    const t = CURRENT_THRESHOLDS[m];
    setSemantic(t.semantic);
    setStylistic(t.stylistic);
    setScope(t.scope);
    setCombined(t.combined);
  };

  const scoreData = useQuery(
    api.voiceCalibration.getEvaluationScoresForSimulation,
    { dateFrom, dateTo }
  );

  const scores: ScoreTuple[] = useMemo(
    () => (scoreData?.[mode] ?? []) as ScoreTuple[],
    [scoreData, mode]
  );

  const proposed: SimulationThresholds = useMemo(
    () => ({ semantic, stylistic, scope, combined }),
    [semantic, stylistic, scope, combined]
  );

  const simulation = useMemo(
    () => simulateThresholds(scores, proposed, mode),
    [scores, proposed, mode]
  );

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Threshold Simulator</h2>
      <p className="text-sm text-gray-500">
        Adjust proposed thresholds to see how many historical evaluations would
        pass or fail. Changes here do not affect production — update{" "}
        <code className="rounded bg-gray-100 px-1">voiceThresholds.ts</code> to
        apply.
      </p>

      <div className="flex gap-2">
        {(["developmental", "line", "copy"] as const).map((m) => (
          <button
            key={m}
            onClick={() => handleModeChange(m)}
            className={`rounded px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
              mode === m
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <ThresholdSlider
          label="Semantic"
          value={semantic}
          current={current.semantic}
          onChange={setSemantic}
        />
        <ThresholdSlider
          label="Stylistic"
          value={stylistic}
          current={current.stylistic}
          onChange={setStylistic}
        />
        <ThresholdSlider
          label="Scope"
          value={scope}
          current={current.scope}
          onChange={setScope}
        />
        <ThresholdSlider
          label="Combined"
          value={combined}
          current={current.combined}
          onChange={setCombined}
        />
      </div>

      {scoreData && (
        <div className="space-y-4">
          {simulation.totalEnforced === 0 ? (
            <p className="text-sm text-gray-400">
              No enforced evaluations found for {mode} mode.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4">
                <ImpactCard
                  label="Current"
                  pass={simulation.currentPassed}
                  fail={simulation.currentFailed}
                  total={simulation.totalEnforced}
                />
                <ImpactCard
                  label="Proposed"
                  pass={simulation.simulatedPassed}
                  fail={simulation.simulatedFailed}
                  total={simulation.totalEnforced}
                  highlight
                />
                <div className="rounded-lg border border-gray-200 p-4 flex flex-col items-center justify-center">
                  <p className="text-xs text-gray-500">Net change</p>
                  <p
                    className={`text-2xl font-bold tabular-nums ${
                      simulation.netChange > 0
                        ? "text-green-600"
                        : simulation.netChange < 0
                          ? "text-red-600"
                          : "text-gray-400"
                    }`}
                  >
                    {simulation.netChange > 0 ? "+" : ""}
                    {simulation.netChange}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {simulation.netChange > 0
                      ? "more passing"
                      : simulation.netChange < 0
                        ? "more failing"
                        : "no change"}
                  </p>
                </div>
              </div>

              {simulation.flips.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">
                    Evaluations that would flip ({simulation.flips.length})
                  </h3>
                  <div className="overflow-x-auto rounded border border-gray-200">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500">
                          <th className="py-1.5 px-3">Direction</th>
                          <th className="py-1.5 px-3">Mode</th>
                          <th className="py-1.5 px-3">Semantic</th>
                          <th className="py-1.5 px-3">Stylistic</th>
                          <th className="py-1.5 px-3">Scope</th>
                          <th className="py-1.5 px-3">Combined</th>
                          <th className="py-1.5 px-3">Failed Dims</th>
                          <th className="py-1.5 px-3">Preview</th>
                        </tr>
                      </thead>
                      <tbody>
                        {simulation.flips.map((flip) => (
                          <tr
                            key={flip.id}
                            className={`border-b ${
                              flip.direction === "pass_to_fail"
                                ? "bg-red-50/30"
                                : "bg-green-50/30"
                            }`}
                          >
                            <td className="py-1.5 px-3">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                  flip.direction === "pass_to_fail"
                                    ? "bg-red-100 text-red-800"
                                    : "bg-green-100 text-green-800"
                                }`}
                              >
                                {flip.direction === "pass_to_fail"
                                  ? "PASS → FAIL"
                                  : "FAIL → PASS"}
                              </span>
                            </td>
                            <td className="py-1.5 px-3 capitalize">
                              {flip.mode}
                            </td>
                            <td className="py-1.5 px-3 tabular-nums">
                              {flip.scores.semantic.toFixed(3)}
                            </td>
                            <td className="py-1.5 px-3 tabular-nums">
                              {flip.scores.stylistic.toFixed(3)}
                            </td>
                            <td className="py-1.5 px-3 tabular-nums">
                              {flip.scores.scope.toFixed(3)}
                            </td>
                            <td className="py-1.5 px-3 tabular-nums">
                              {flip.scores.combined.toFixed(3)}
                            </td>
                            <td className="py-1.5 px-3">
                              <div className="flex gap-1">
                                {flip.failedDimensions.map((d) => (
                                  <span
                                    key={d}
                                    className="rounded bg-gray-200 px-1 py-0.5 text-[10px]"
                                  >
                                    {d}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="py-1.5 px-3 max-w-[200px] truncate text-gray-500">
                              {flip.originalPreview
                                ? `${flip.originalPreview.slice(0, 80)}…`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ThresholdSlider({
  label,
  value,
  current,
  onChange,
}: {
  label: string;
  value: number;
  current: number;
  onChange: (v: number) => void;
}) {
  const changed = Math.abs(value - current) > 0.001;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex items-center gap-2">
          {changed && (
            <span className="text-[10px] text-gray-400 line-through">
              {current.toFixed(2)}
            </span>
          )}
          <span
            className={`text-sm font-bold tabular-nums ${
              changed ? "text-gray-900" : ""
            }`}
          >
            {value.toFixed(2)}
          </span>
        </div>
      </div>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-gray-700"
      />
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>0.00 (permissive)</span>
        <span>1.00 (strict)</span>
      </div>
    </div>
  );
}

function ImpactCard({
  label,
  pass,
  fail,
  total,
  highlight,
}: {
  label: string;
  pass: number;
  fail: number;
  total: number;
  highlight?: boolean;
}) {
  const rate = total > 0 ? (pass / total) * 100 : 100;

  return (
    <div
      className={`rounded-lg border p-4 ${
        highlight ? "border-gray-400" : "border-gray-200"
      }`}
    >
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold tabular-nums">
        {rate.toFixed(1)}%{" "}
        <span className="text-sm font-normal text-gray-400">pass</span>
      </p>
      <p className="text-xs text-gray-400">
        {pass} pass / {fail} fail / {total} total
      </p>
    </div>
  );
}
