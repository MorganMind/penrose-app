"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";

type EditorialMode = "developmental" | "line" | "copy";

const DIMENSION_COLORS: Record<string, string> = {
  semantic: "bg-purple-100 text-purple-800",
  stylistic: "bg-orange-100 text-orange-800",
  scope: "bg-cyan-100 text-cyan-800",
  combined: "bg-gray-100 text-gray-800",
};

export function EvaluationList({
  onSelect,
  selectedId,
}: {
  onSelect: (id: Id<"voiceEvaluations">) => void;
  selectedId: Id<"voiceEvaluations"> | null;
}) {
  const [modeFilter, setModeFilter] = useState<EditorialMode | undefined>();
  const [passedFilter, setPassedFilter] = useState<boolean | undefined>();

  const evaluations = useQuery(
    api.voiceCalibration.listEvaluationsWithFailureLabels,
    {
      limit: 100,
      modeFilter,
      passedFilter,
    }
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-3 items-center">
        <span className="text-sm font-medium text-gray-500">Filter:</span>
        <select
          className="rounded border border-gray-300 px-2 py-1 text-sm bg-white"
          value={modeFilter ?? "all"}
          onChange={(e) =>
            setModeFilter(
              e.target.value === "all"
                ? undefined
                : (e.target.value as EditorialMode)
            )
          }
        >
          <option value="all">All modes</option>
          <option value="developmental">Developmental</option>
          <option value="line">Line</option>
          <option value="copy">Copy</option>
        </select>
        <select
          className="rounded border border-gray-300 px-2 py-1 text-sm bg-white"
          value={
            passedFilter === undefined
              ? "all"
              : passedFilter
                ? "passed"
                : "failed"
          }
          onChange={(e) =>
            setPassedFilter(
              e.target.value === "all"
                ? undefined
                : e.target.value === "passed"
            )
          }
        >
          <option value="all">All results</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
        </select>
        {evaluations && (
          <span className="text-xs text-gray-400">
            {evaluations.length} evaluations
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
              <th className="py-2 px-3">Time</th>
              <th className="py-2 px-3">Mode</th>
              <th className="py-2 px-3">Semantic</th>
              <th className="py-2 px-3">Stylistic</th>
              <th className="py-2 px-3">Scope</th>
              <th className="py-2 px-3">Combined</th>
              <th className="py-2 px-3">Status</th>
              <th className="py-2 px-3">Failed Dimensions</th>
              <th className="py-2 px-3">Correction</th>
            </tr>
          </thead>
          <tbody>
            {evaluations?.map((e) => (
              <tr
                key={e._id}
                className={`border-b border-gray-100 cursor-pointer transition-colors ${
                  selectedId === e._id ? "bg-gray-100" : "hover:bg-gray-50"
                }`}
                onClick={() => onSelect(e._id)}
              >
                <td className="py-2 px-3 tabular-nums text-xs">
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td className="py-2 px-3 capitalize text-xs">
                  {e.editorialMode}
                </td>
                <td className="py-2 px-3">
                  <ScoreCell
                    value={e.semanticScore}
                    headroom={e.headroom.semantic}
                  />
                </td>
                <td className="py-2 px-3">
                  <ScoreCell
                    value={e.stylisticScore}
                    headroom={e.headroom.stylistic}
                  />
                </td>
                <td className="py-2 px-3">
                  <ScoreCell
                    value={e.scopeScore}
                    headroom={e.headroom.scope}
                  />
                </td>
                <td className="py-2 px-3">
                  <ScoreCell
                    value={e.combinedScore}
                    headroom={e.headroom.combined}
                  />
                </td>
                <td className="py-2 px-3">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                      e.passed
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {e.passed ? "PASS" : "FAIL"}
                  </span>
                  {!e.enforced && (
                    <span className="ml-1 text-[10px] text-gray-400">
                      (unenforced)
                    </span>
                  )}
                </td>
                <td className="py-2 px-3">
                  <div className="flex gap-1 flex-wrap">
                    {e.failedDimensions.length === 0 ? (
                      <span className="text-xs text-gray-400">—</span>
                    ) : (
                      e.failedDimensions.map((dim) => {
                        const headroom = e.headroom[dim as keyof typeof e.headroom];
                        const gap =
                          headroom !== undefined && headroom < 0
                            ? Math.abs(headroom).toFixed(2)
                            : null;
                        return (
                          <span
                            key={dim}
                            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              DIMENSION_COLORS[dim] ?? DIMENSION_COLORS.combined
                            }`}
                            title={gap ? `Gap: ${gap} below threshold` : undefined}
                          >
                            {dim}
                            {gap && (
                              <span className="ml-0.5 opacity-80">-{gap}</span>
                            )}
                          </span>
                        );
                      })
                    )}
                  </div>
                </td>
                <td className="py-2 px-3 text-xs text-gray-500">
                  {e.correctionType ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScoreCell({
  value,
  headroom,
}: {
  value: number;
  headroom: number;
}) {
  const failed = headroom < 0;
  return (
    <div className="flex items-center gap-1">
      <span
        className={`tabular-nums text-xs ${
          failed
            ? "text-red-600 font-semibold"
            : "text-gray-700"
        }`}
      >
        {value.toFixed(3)}
      </span>
      <span
        className={`text-[10px] tabular-nums ${
          failed ? "text-red-500" : "text-green-600"
        }`}
      >
        {headroom >= 0 ? "+" : ""}
        {headroom.toFixed(3)}
      </span>
    </div>
  );
}
