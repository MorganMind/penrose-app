"use client";

import { useState } from "react";

type Fingerprint = {
  avgSentenceLength: number;
  sentenceLengthVariance: number;
  sentenceLengthStdDev: number;
  avgParagraphLength: number;
  paragraphLengthVariance: number;
  punctuationFrequencies: Record<string, number>;
  adjectiveAdverbDensity: number;
  hedgingFrequency: number;
  stopwordDensity: number;
  contractionFrequency: number;
  questionRatio: number;
  exclamationRatio: number;
  repetitionIndex: number;
  vocabularyRichness: number;
  avgWordLength: number;
  readabilityScore: number;
  complexityScore: number;
  lexicalSignature: Array<{ word: string; frequency: number }>;
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  confidence: number;
};

type ComparisonMode = "original_vs_suggestion" | "suggestion_vs_profile";

const SIGNIFICANCE: Record<
  string,
  {
    yellow: number;
    red: number;
    format: "fixed1" | "fixed2" | "fixed3" | "fixed4" | "int";
  }
> = {
  avgSentenceLength: { yellow: 3, red: 6, format: "fixed1" },
  sentenceLengthStdDev: { yellow: 3, red: 7, format: "fixed2" },
  avgParagraphLength: { yellow: 1.5, red: 3, format: "fixed1" },
  adjectiveAdverbDensity: { yellow: 0.03, red: 0.06, format: "fixed4" },
  hedgingFrequency: { yellow: 0.08, red: 0.15, format: "fixed4" },
  stopwordDensity: { yellow: 0.04, red: 0.08, format: "fixed4" },
  contractionFrequency: { yellow: 0.015, red: 0.03, format: "fixed4" },
  questionRatio: { yellow: 0.06, red: 0.12, format: "fixed4" },
  exclamationRatio: { yellow: 0.04, red: 0.08, format: "fixed4" },
  repetitionIndex: { yellow: 0.04, red: 0.08, format: "fixed4" },
  vocabularyRichness: { yellow: 0.05, red: 0.1, format: "fixed4" },
  avgWordLength: { yellow: 0.4, red: 0.8, format: "fixed2" },
  readabilityScore: { yellow: 1.5, red: 3, format: "fixed2" },
  complexityScore: { yellow: 0.15, red: 0.3, format: "fixed2" },
  wordCount: { yellow: 30, red: 80, format: "int" },
  sentenceCount: { yellow: 3, red: 6, format: "int" },
  paragraphCount: { yellow: 1, red: 3, format: "int" },
};

const SCALAR_METRICS: Array<{ key: string; label: string }> = [
  { key: "avgSentenceLength", label: "Avg sentence length" },
  { key: "sentenceLengthStdDev", label: "Sentence length σ" },
  { key: "avgParagraphLength", label: "Avg paragraph length" },
  { key: "adjectiveAdverbDensity", label: "Adjective/adverb density" },
  { key: "hedgingFrequency", label: "Hedging frequency" },
  { key: "stopwordDensity", label: "Stopword density" },
  { key: "contractionFrequency", label: "Contraction frequency" },
  { key: "questionRatio", label: "Question ratio" },
  { key: "exclamationRatio", label: "Exclamation ratio" },
  { key: "repetitionIndex", label: "Repetition index" },
  { key: "vocabularyRichness", label: "Vocabulary richness" },
  { key: "avgWordLength", label: "Avg word length" },
  { key: "readabilityScore", label: "Readability (FK grade)" },
  { key: "complexityScore", label: "Complexity (syl/word)" },
  { key: "wordCount", label: "Word count" },
  { key: "sentenceCount", label: "Sentence count" },
  { key: "paragraphCount", label: "Paragraph count" },
];

const PUNCTUATION_KEYS = [
  "comma",
  "period",
  "semicolon",
  "colon",
  "exclamation",
  "question",
  "dash",
  "ellipsis",
  "parenthetical",
];

export function FingerprintDiff({
  original,
  suggestion,
  profile,
}: {
  original: Fingerprint;
  suggestion: Fingerprint;
  profile: Fingerprint | null;
}) {
  const [mode, setMode] = useState<ComparisonMode>(
    profile ? "suggestion_vs_profile" : "original_vs_suggestion"
  );
  const [showPunctuation, setShowPunctuation] = useState(false);
  const [showLexical, setShowLexical] = useState(false);

  const base =
    mode === "original_vs_suggestion" ? original : profile ?? original;
  const target = suggestion;

  const baseLabel =
    mode === "original_vs_suggestion" ? "Original" : "Profile";
  const targetLabel = "Suggestion";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Fingerprint Comparison</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setMode("original_vs_suggestion")}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === "original_vs_suggestion"
                ? "bg-gray-800 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Original → Suggestion
          </button>
          {profile && (
            <button
              onClick={() => setMode("suggestion_vs_profile")}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === "suggestion_vs_profile"
                  ? "bg-gray-800 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              Profile → Suggestion
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500">
              <th className="py-1.5 px-3 w-48">Metric</th>
              <th className="py-1.5 px-3 text-right w-24">{baseLabel}</th>
              <th className="py-1.5 px-3 text-right w-24">{targetLabel}</th>
              <th className="py-1.5 px-3 text-right w-24">Δ Absolute</th>
              <th className="py-1.5 px-3 text-right w-20">Δ %</th>
              <th className="py-1.5 px-3 w-32">Drift</th>
            </tr>
          </thead>
          <tbody>
            {SCALAR_METRICS.map(({ key, label }) => {
              const baseRaw = (base as Record<string, unknown>)[key];
              const targetRaw = (target as Record<string, unknown>)[key];
              const baseVal = typeof baseRaw === "number" ? baseRaw : 0;
              const targetVal = typeof targetRaw === "number" ? targetRaw : 0;
              const delta = targetVal - baseVal;
              const pctChange =
                baseVal !== 0
                  ? ((targetVal - baseVal) / Math.abs(baseVal)) * 100
                  : targetVal === 0
                    ? 0
                    : 100;

              const sig = SIGNIFICANCE[key];
              const absDelta = Math.abs(delta);

              let severity: "none" | "yellow" | "red" = "none";
              if (sig) {
                if (absDelta >= sig.red) severity = "red";
                else if (absDelta >= sig.yellow) severity = "yellow";
              }

              const fmt = (v: number) => {
                if (!sig) return v.toFixed(2);
                switch (sig.format) {
                  case "int":
                    return Math.round(v).toString();
                  case "fixed1":
                    return v.toFixed(1);
                  case "fixed2":
                    return v.toFixed(2);
                  case "fixed3":
                    return v.toFixed(3);
                  case "fixed4":
                    return v.toFixed(4);
                  default:
                    return v.toFixed(3);
                }
              };

              return (
                <tr
                  key={key}
                  className={`border-b last:border-0 ${
                    severity === "red"
                      ? "bg-red-50/60"
                      : severity === "yellow"
                        ? "bg-amber-50/60"
                        : ""
                  }`}
                >
                  <td className="py-1 px-3 text-gray-600">{label}</td>
                  <td className="py-1 px-3 text-right tabular-nums text-gray-700">
                    {fmt(baseVal)}
                  </td>
                  <td className="py-1 px-3 text-right tabular-nums text-gray-700">
                    {fmt(targetVal)}
                  </td>
                  <td className="py-1 px-3 text-right tabular-nums">
                    <DeltaValue
                      value={delta}
                      format={sig?.format ?? "fixed3"}
                    />
                  </td>
                  <td className="py-1 px-3 text-right tabular-nums">
                    <DeltaValue
                      value={pctChange}
                      format="fixed1"
                      suffix="%"
                    />
                  </td>
                  <td className="py-1 px-3">
                    <DriftBar
                      delta={absDelta}
                      yellow={sig?.yellow ?? 0.05}
                      red={sig?.red ?? 0.1}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <button
          onClick={() => setShowPunctuation(!showPunctuation)}
          className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
        >
          <span>{showPunctuation ? "▼" : "▶"}</span>
          Punctuation distribution (per 1000 words)
        </button>
        {showPunctuation && (
          <div className="mt-2 overflow-x-auto rounded border border-gray-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500">
                  <th className="py-1.5 px-3">Punctuation</th>
                  <th className="py-1.5 px-3 text-right">{baseLabel}</th>
                  <th className="py-1.5 px-3 text-right">{targetLabel}</th>
                  <th className="py-1.5 px-3 text-right">Δ</th>
                </tr>
              </thead>
              <tbody>
                {PUNCTUATION_KEYS.map((key) => {
                  const baseVal =
                    (base.punctuationFrequencies ?? {})[key] ?? 0;
                  const targetVal =
                    (target.punctuationFrequencies ?? {})[key] ?? 0;
                  const delta = targetVal - baseVal;
                  return (
                    <tr key={key} className="border-b last:border-0">
                      <td className="py-1 px-3 capitalize text-gray-600">
                        {key}
                      </td>
                      <td className="py-1 px-3 text-right tabular-nums">
                        {baseVal.toFixed(1)}
                      </td>
                      <td className="py-1 px-3 text-right tabular-nums">
                        {targetVal.toFixed(1)}
                      </td>
                      <td className="py-1 px-3 text-right tabular-nums">
                        <DeltaValue value={delta} format="fixed1" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <button
          onClick={() => setShowLexical(!showLexical)}
          className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
        >
          <span>{showLexical ? "▼" : "▶"}</span>
          Lexical signature comparison
        </button>
        {showLexical && (
          <LexicalComparison
            base={base.lexicalSignature ?? []}
            target={target.lexicalSignature ?? []}
            baseLabel={baseLabel}
            targetLabel={targetLabel}
          />
        )}
      </div>
    </div>
  );
}

function DeltaValue({
  value,
  format,
  suffix = "",
}: {
  value: number;
  format: string;
  suffix?: string;
}) {
  const isPositive = value > 0.0001;
  const isNegative = value < -0.0001;
  const isZero = !isPositive && !isNegative;

  let formatted: string;
  switch (format) {
    case "int":
      formatted = Math.round(Math.abs(value)).toString();
      break;
    case "fixed1":
      formatted = Math.abs(value).toFixed(1);
      break;
    case "fixed2":
      formatted = Math.abs(value).toFixed(2);
      break;
    case "fixed4":
      formatted = Math.abs(value).toFixed(4);
      break;
    default:
      formatted = Math.abs(value).toFixed(3);
  }

  if (isZero) {
    return (
      <span className="text-gray-300">0{suffix}</span>
    );
  }

  return (
    <span
      className={
        isPositive ? "text-amber-600" : "text-blue-600"
      }
    >
      {isPositive ? "+" : "−"}
      {formatted}
      {suffix}
    </span>
  );
}

function DriftBar({
  delta,
  yellow,
  red,
}: {
  delta: number;
  yellow: number;
  red: number;
}) {
  const maxWidth = red * 2;
  const widthPct = Math.min(100, (delta / maxWidth) * 100);

  let color = "bg-green-400";
  if (delta >= red) color = "bg-red-400";
  else if (delta >= yellow) color = "bg-amber-400";

  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span className="text-[10px] text-gray-400 w-8">
        {delta >= red ? "!!!" : delta >= yellow ? "!" : "ok"}
      </span>
    </div>
  );
}

function LexicalComparison({
  base,
  target,
  baseLabel,
  targetLabel,
}: {
  base: Array<{ word: string; frequency: number }>;
  target: Array<{ word: string; frequency: number }>;
  baseLabel: string;
  targetLabel: string;
}) {
  const baseMap = new Map(base.map((e) => [e.word, e.frequency]));
  const targetMap = new Map(target.map((e) => [e.word, e.frequency]));
  const allWords = new Set([...baseMap.keys(), ...targetMap.keys()]);

  const rows = [...allWords]
    .map((word) => ({
      word,
      baseFreq: baseMap.get(word) ?? 0,
      targetFreq: targetMap.get(word) ?? 0,
    }))
    .sort((a, b) => {
      const maxA = Math.max(a.baseFreq, a.targetFreq);
      const maxB = Math.max(b.baseFreq, b.targetFreq);
      return maxB - maxA;
    })
    .slice(0, 30);

  return (
    <div className="mt-2 overflow-x-auto rounded border border-gray-200">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500">
            <th className="py-1.5 px-3">Word</th>
            <th className="py-1.5 px-3 text-right">{baseLabel} %</th>
            <th className="py-1.5 px-3 text-right">{targetLabel} %</th>
            <th className="py-1.5 px-3">Presence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ word, baseFreq, targetFreq }) => {
            const onlyInBase = baseFreq > 0 && targetFreq === 0;
            const onlyInTarget = baseFreq === 0 && targetFreq > 0;

            return (
              <tr
                key={word}
                className={`border-b last:border-0 ${
                  onlyInBase
                    ? "bg-red-50/40"
                    : onlyInTarget
                      ? "bg-blue-50/40"
                      : ""
                }`}
              >
                <td className="py-1 px-3 font-mono">{word}</td>
                <td className="py-1 px-3 text-right tabular-nums">
                  {baseFreq > 0 ? (baseFreq * 100).toFixed(2) : "—"}
                </td>
                <td className="py-1 px-3 text-right tabular-nums">
                  {targetFreq > 0 ? (targetFreq * 100).toFixed(2) : "—"}
                </td>
                <td className="py-1 px-3 text-[10px]">
                  {onlyInBase && (
                    <span className="text-red-500">dropped</span>
                  )}
                  {onlyInTarget && (
                    <span className="text-blue-500">introduced</span>
                  )}
                  {baseFreq > 0 && targetFreq > 0 && (
                    <span className="text-gray-400">both</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
