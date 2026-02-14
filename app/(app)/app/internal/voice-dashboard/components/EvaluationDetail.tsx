"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { FingerprintDiff } from "./FingerprintDiff";
import type { Id } from "@/convex/_generated/dataModel";

export function EvaluationDetail({
  evaluationId,
}: {
  evaluationId: Id<"voiceEvaluations">;
}) {
  const evalData = useQuery(api.voiceEvaluations.getById, { evaluationId });

  if (!evalData) {
    return (
      <div className="rounded-lg border border-gray-200 p-6">
        <p className="text-sm text-gray-400">Loading evaluation…</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Evaluation Detail</h2>
        <span className="text-xs text-gray-400 tabular-nums">
          {new Date(evalData.createdAt).toLocaleString()}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="text-xs font-medium text-gray-500 mb-1">Original</h3>
          <pre className="text-xs whitespace-pre-wrap rounded bg-gray-50 p-3 max-h-40 overflow-y-auto font-sans">
            {evalData.originalPreview}
          </pre>
        </div>
        <div>
          <h3 className="text-xs font-medium text-gray-500 mb-1">Suggestion</h3>
          <pre className="text-xs whitespace-pre-wrap rounded bg-gray-50 p-3 max-h-40 overflow-y-auto font-sans">
            {evalData.suggestionPreview}
          </pre>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <ScoreCard
          label="Semantic"
          score={evalData.semanticScore}
          threshold={evalData.thresholds.semantic}
        />
        <ScoreCard
          label="Stylistic"
          score={evalData.stylisticScore}
          threshold={evalData.thresholds.stylistic}
        />
        <ScoreCard
          label="Scope"
          score={evalData.scopeScore}
          threshold={evalData.thresholds.scope}
        />
        <ScoreCard
          label="Combined"
          score={evalData.combinedScore}
          threshold={evalData.thresholds.combined}
        />
      </div>

      {evalData.originalFingerprint && evalData.suggestionFingerprint && (
        <FingerprintDiff
          original={evalData.originalFingerprint}
          suggestion={evalData.suggestionFingerprint}
          profile={evalData.profileFingerprint ?? null}
        />
      )}

      <div className="text-xs text-gray-400 space-y-1 border-t border-gray-100 pt-4">
        <p>
          <span className="text-gray-500 font-medium">Provider:</span>{" "}
          {evalData.provider} ·{" "}
          <span className="text-gray-500 font-medium">Model:</span>{" "}
          {evalData.model} ·{" "}
          <span className="text-gray-500 font-medium">Prompt:</span>{" "}
          <code className="bg-gray-100 px-1 rounded">{evalData.promptVersion}</code>
        </p>
        <p>
          <span className="text-gray-500 font-medium">Profile:</span>{" "}
          {evalData.profileStatus} ·{" "}
          <span className="text-gray-500 font-medium">Enforced:</span>{" "}
          {evalData.enforced ? "Yes" : "No"} ·{" "}
          <span className="text-gray-500 font-medium">Mode:</span>{" "}
          {evalData.editorialMode}
        </p>
        {evalData.correctionAttempted && (
          <p>
            <span className="text-gray-500 font-medium">Correction:</span>{" "}
            {evalData.correctionType} ·{" "}
            <span className="text-gray-500 font-medium">Improved:</span>{" "}
            {evalData.correctionImprovedScore ? "Yes" : "No"} ·{" "}
            <span className="text-gray-500 font-medium">Final score:</span>{" "}
            {evalData.finalCombinedScore?.toFixed(4) ?? "—"}
          </p>
        )}
      </div>
    </div>
  );
}

function ScoreCard({
  label,
  score,
  threshold,
}: {
  label: string;
  score: number;
  threshold: number;
}) {
  const passed = score >= threshold;
  const headroom = score - threshold;

  return (
    <div
      className={`rounded-lg border p-3 ${
        passed
          ? "border-gray-200"
          : "border-red-200 bg-red-50/50"
      }`}
    >
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p
        className={`text-xl font-bold tabular-nums ${
          passed ? "text-gray-800" : "text-red-600"
        }`}
      >
        {score.toFixed(4)}
      </p>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-gray-400">
          threshold {threshold.toFixed(2)}
        </span>
        <span
          className={`text-[10px] font-medium tabular-nums ${
            passed ? "text-green-600" : "text-red-500"
          }`}
        >
          {headroom >= 0 ? "+" : ""}
          {headroom.toFixed(4)}
        </span>
      </div>
    </div>
  );
}
