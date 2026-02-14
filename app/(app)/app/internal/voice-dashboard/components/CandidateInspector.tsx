"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { formatScore } from "../lib/analysisUtils";

export function CandidateInspector() {
  const [modeFilter, setModeFilter] = useState<string | undefined>();
  const [selectedRunId, setSelectedRunId] =
    useState<Id<"editorialRuns"> | null>(null);

  const runs = useQuery(api.voiceAnalytics.listRuns, {
    limit: 50,
    modeFilter: modeFilter as "developmental" | "line" | undefined,
  });
  const stats = useQuery(api.voiceAnalytics.getMultiCandidateStats);
  const runDetail = useQuery(
    api.voiceAnalytics.getRunWithCandidates,
    selectedRunId ? { runId: selectedRunId } : "skip"
  );
  const explainability = useQuery(
    api.voiceRunExplainability.getByRunId,
    selectedRunId ? { runId: selectedRunId } : "skip"
  );

  return (
    <div className="space-y-6">
      {/* Stats summary */}
      {stats && (
        <div className="grid grid-cols-5 gap-3">
          <MiniStat label="Total runs" value={stats.totalRuns} />
          <MiniStat
            label="Fallback rate"
            value={`${(stats.fallbackRate * 100).toFixed(1)}%`}
          />
          <MiniStat
            label="All-passed rate"
            value={`${(stats.allPassedRate * 100).toFixed(1)}%`}
          />
          <MiniStat
            label="Avg selection Δ"
            value={stats.avgSelectionDelta.toFixed(4)}
          />
          <MiniStat
            label="Avg combined Δ"
            value={stats.avgCombinedDelta.toFixed(4)}
          />
        </div>
      )}

      {/* Variation win rates */}
      {stats && Object.keys(stats.byVariation).length > 0 && (
        <div className="rounded-lg border border-gray-200 p-4">
          <h4 className="mb-2 text-sm font-semibold">
            Variation performance
          </h4>
          <div className="grid grid-cols-3 gap-3">
            {Object.entries(stats.byVariation)
              .sort(([, a], [, b]) => b.avgSelection - a.avgSelection)
              .map(([key, v]) => (
                <div
                  key={key}
                  className="rounded border border-gray-100 p-2 text-xs"
                >
                  <p className="font-medium">{key.replace(/_/g, " ")}</p>
                  <p className="text-gray-500">
                    {v.count} uses · {v.wins} wins (
                    {v.count > 0
                      ? ((v.wins / v.count) * 100).toFixed(0)
                      : 0}
                    %) · avg {v.avgSelection.toFixed(3)}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <select
          className="rounded border border-gray-300 px-2 py-1 text-sm bg-white"
          value={modeFilter ?? "all"}
          onChange={(e) =>
            setModeFilter(
              e.target.value === "all" ? undefined : e.target.value
            )
          }
        >
          <option value="all">All modes</option>
          <option value="developmental">Developmental</option>
          <option value="line">Line</option>
        </select>
        <span className="ml-auto text-xs text-gray-500">
          {runs?.length ?? 0} runs
        </span>
      </div>

      {/* Run list */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="py-2 pr-3 font-medium">Time</th>
              <th className="py-2 pr-3 font-medium">Mode</th>
              <th className="py-2 pr-3 font-medium">Seed</th>
              <th className="py-2 pr-3 font-medium">Candidates</th>
              <th className="py-2 pr-3 font-medium">Winner</th>
              <th className="py-2 pr-3 font-medium">All passed</th>
              <th className="py-2 pr-3 font-medium">Fallback</th>
              <th className="py-2 pr-3 font-medium">Nudge</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {runs?.map((run) => (
              <tr
                key={run._id}
                className={`border-b cursor-pointer hover:bg-gray-50 ${
                  selectedRunId === run._id
                    ? "bg-gray-100"
                    : ""
                }`}
                onClick={() => setSelectedRunId(run._id)}
              >
                <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                  {new Date(run.createdAt).toLocaleString()}
                </td>
                <td className="py-2 pr-3 capitalize">{run.editorialMode}</td>
                <td className="py-2 pr-3 tabular-nums">{run.variationSeed}</td>
                <td className="py-2 pr-3 tabular-nums">
                  {run.candidateCount}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  #{run.selectedCandidateIndex}
                </td>
                <td className="py-2 pr-3">
                  {run.allCandidatesPassed ? "✓" : "✗"}
                </td>
                <td className="py-2 pr-3">
                  {run.fallbackUsed ? (
                    <span className="text-amber-600">yes</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2 pr-3 text-gray-500">
                  {run.nudgeDirection ?? "—"}
                </td>
                <td className="py-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      run.status === "active"
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {run.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Run detail */}
      {runDetail && (
        <div className="rounded-lg border border-gray-200 p-4 space-y-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">
              Run detail — seed {runDetail.run.variationSeed},{" "}
              {runDetail.run.candidateCount} candidates
            </h3>
            <span className="text-xs text-gray-400 font-mono">
              {runDetail.run.model} · {runDetail.run.promptVersion.slice(0, 8)}
            </span>
          </div>

          <p className="text-xs text-gray-500 whitespace-pre-wrap rounded bg-gray-50 p-2">
            {runDetail.run.originalPreview}…
          </p>

          {/* Explainability (Phase 14.5 Part 4) */}
          {explainability && (
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
              <h4 className="mb-2 text-xs font-semibold">
                Metric influence
              </h4>
              <div className="grid grid-cols-4 gap-2 text-xs tabular-nums mb-2">
                <span>Cadence Δ: {explainability.cadenceDelta.toFixed(3)}</span>
                <span>Punctuation Δ: {explainability.punctuationDelta.toFixed(3)}</span>
                <span>Lexical Δ: {explainability.lexicalDensityDelta.toFixed(3)}</span>
                <span>Semantic Δ: {explainability.semanticDelta.toFixed(3)}</span>
              </div>
              {explainability.constraintViolations.length > 0 && (
                <p className="text-xs text-amber-600 mb-2">
                  Violations: {explainability.constraintViolations.join(", ")}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="font-medium text-zinc-500 mb-1">Top negative</p>
                  {explainability.topNegativeInfluences.map((n) => (
                    <p key={n.metric}>
                      {n.metric}: {n.rawScore.toFixed(3)} × {n.weight.toFixed(2)} = {n.contribution.toFixed(4)}
                    </p>
                  ))}
                </div>
                <div>
                  <p className="font-medium text-zinc-500 mb-1">Top positive</p>
                  {explainability.topPositiveInfluences.map((n) => (
                    <p key={n.metric}>
                      {n.metric}: {n.rawScore.toFixed(3)} × {n.weight.toFixed(2)} = {n.contribution.toFixed(4)}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Candidate comparison */}
          <div className="space-y-3">
            {runDetail.candidates.map((c) => (
              <div
                key={c._id}
                className={`rounded-lg border p-3 ${
                  c.selected
                    ? "border-blue-300 bg-blue-50/50"
                    : c.isFallback
                      ? "border-amber-300 bg-amber-50/50"
                      : "border-gray-200"
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-semibold">
                    Candidate #{c.candidateIndex}
                  </span>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
                    {c.variationKey.replace(/_/g, " ")}
                  </span>
                  {c.selected && (
                    <span className="rounded bg-blue-200 px-1.5 py-0.5 text-xs font-medium text-blue-800">
                      SELECTED
                    </span>
                  )}
                  {c.shown && !c.selected && (
                    <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs">
                      SHOWN
                    </span>
                  )}
                  {c.isFallback && (
                    <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                      FALLBACK
                    </span>
                  )}
                  <span
                    className={`ml-auto rounded px-1.5 py-0.5 text-xs font-medium ${
                      c.passed
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {c.passed ? "PASS" : "FAIL"}
                  </span>
                </div>

                {/* Scores */}
                <div className="grid grid-cols-5 gap-3 text-xs tabular-nums mb-2">
                  <ScoreBox
                    label="Semantic"
                    value={c.semanticScore}
                  />
                  <ScoreBox
                    label="Stylistic"
                    value={c.stylisticScore}
                  />
                  <ScoreBox label="Scope" value={c.scopeScore} />
                  <ScoreBox
                    label="Combined"
                    value={c.combinedScore}
                  />
                  <ScoreBox
                    label="Selection"
                    value={c.selectionScore}
                    highlight
                  />
                </div>

                {/* Text preview */}
                <p className="text-xs text-gray-600 whitespace-pre-wrap rounded bg-white p-2">
                  {c.suggestionPreview}…
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

function ScoreBox({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="text-center">
      <p className="text-gray-400 text-xs">{label}</p>
      <p
        className={`text-sm tabular-nums ${
          highlight ? "font-semibold text-blue-600" : ""
        }`}
      >
        {formatScore(value)}
      </p>
    </div>
  );
}
