"use client";

import { useState } from "react";
import Link from "next/link";
import { ScoreDistributions } from "./components/ScoreDistributions";
import { FailureAnalysis } from "./components/FailureAnalysis";
import { ThresholdSimulator } from "./components/ThresholdSimulator";
import { ModelDrift } from "./components/ModelDrift";
import { CorrectionMetrics } from "./components/CorrectionMetrics";
import { EvaluationList } from "./components/EvaluationList";
import { EvaluationDetail } from "./components/EvaluationDetail";
import { CandidateInspector } from "./components/CandidateInspector";
import { EnforcementPanel } from "./components/EnforcementPanel";
import { ConfidencePanel } from "./components/ConfidencePanel";
import { DriftPanel } from "./components/DriftPanel";
import type { Id } from "@/convex/_generated/dataModel";

type Tab =
  | "overview"
  | "distributions"
  | "failures"
  | "thresholds"
  | "models"
  | "corrections"
  | "candidates"
  | "enforcement"
  | "confidence"
  | "drift";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "distributions", label: "Distributions" },
  { key: "candidates", label: "Candidates" },
  { key: "enforcement", label: "Enforcement" },
  { key: "confidence", label: "Confidence" },
  { key: "drift", label: "Drift Alerts" },
  { key: "failures", label: "Failure Analysis" },
  { key: "thresholds", label: "Threshold Sim" },
  { key: "models", label: "Model Drift" },
  { key: "corrections", label: "Corrections" },
];

export default function VoiceDashboard() {
  const isDev = process.env.NEXT_PUBLIC_VOICE_ENGINE_DEBUG === "true";
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedEvalId, setSelectedEvalId] =
    useState<Id<"voiceEvaluations"> | null>(null);
  const [dateFrom, setDateFrom] = useState<number | undefined>();
  const [dateTo, setDateTo] = useState<number | undefined>();

  if (!isDev) {
    return (
      <div className="p-8 text-center text-sm text-gray-500">
        Voice dashboard is disabled. Set{" "}
        <code className="rounded bg-gray-100 px-1 py-0.5">
          NEXT_PUBLIC_VOICE_ENGINE_DEBUG=true
        </code>{" "}
        to enable.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Voice Identity Engine</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/app/internal/regression"
            className="text-sm text-gray-600 hover:text-gray-900 underline"
          >
            Regression
          </Link>
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            DEV ONLY
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-b border-gray-200 pb-2">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">From</label>
          <input
            type="date"
            className="rounded border border-gray-200 px-2 py-1 text-xs"
            onChange={(e) => {
              const v = e.target.value;
              setDateFrom(v ? new Date(v).getTime() : undefined);
            }}
          />
          <label className="text-xs text-gray-500">To</label>
          <input
            type="date"
            className="rounded border border-gray-200 px-2 py-1 text-xs"
            onChange={(e) => {
              const v = e.target.value;
              setDateTo(v ? new Date(v).getTime() : undefined);
            }}
          />
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => {
                setDateFrom(undefined);
                setDateTo(undefined);
              }}
              className="text-xs text-gray-500 underline hover:text-gray-700"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex gap-1 flex-1">
          {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setSelectedEvalId(null);
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
        </div>
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          <EvaluationList
            onSelect={setSelectedEvalId}
            selectedId={selectedEvalId}
          />
          {selectedEvalId && (
            <EvaluationDetail evaluationId={selectedEvalId} />
          )}
        </div>
      )}

      {tab === "distributions" && (
        <ScoreDistributions dateFrom={dateFrom} dateTo={dateTo} />
      )}
      {tab === "candidates" && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">
            Multi-Candidate Runs
          </h2>
          <p className="mb-4 text-sm text-gray-500">
            Each developmental and line edit generates 2 scored candidates
            using controlled prompt variations. Inspect which variation won,
            how scores compared, and how often fallbacks were needed.
          </p>
          <CandidateInspector />
        </div>
      )}
      {tab === "enforcement" && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">
            Tiered Enforcement
          </h2>
          <p className="mb-4 text-sm text-zinc-500">
            Classification distribution, retry effectiveness, and
            enforcement outcomes. Tracks how often each tier triggers and
            whether enforcement retries successfully recover to a passing
            candidate or fall back to returning the original text.
          </p>
          <EnforcementPanel />
        </div>
      )}
      {tab === "confidence" && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">
            Profile Confidence
          </h2>
          <p className="mb-4 text-sm text-zinc-500">
            Profile confidence determines how aggressively stylistic
            enforcement applies. New profiles start lenient on style
            (strict on meaning) and tighten as word volume, sample count,
            source diversity, and temporal spread increase.
          </p>
          <ConfidencePanel />
        </div>
      )}
      {tab === "drift" && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">
            Cross-Run Drift Detection
          </h2>
          <p className="mb-4 text-sm text-zinc-500">
            Rolling metrics per user: average voice similarity, semantic
            preservation, score variance. Alerts when similarity drops
            or variance spikes. Model id and prompt version stored with
            every run for regression tracing.
          </p>
          <DriftPanel />
        </div>
      )}
      {tab === "failures" && <FailureAnalysis />}
      {tab === "thresholds" && (
        <ThresholdSimulator dateFrom={dateFrom} dateTo={dateTo} />
      )}
      {tab === "models" && <ModelDrift />}
      {tab === "corrections" && <CorrectionMetrics />}
    </div>
  );
}
