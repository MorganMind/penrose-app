#!/usr/bin/env npx tsx
/**
 * Voice scoring calibration script.
 *
 * Runs the scoring engine across the calibration dataset, validates that
 * good edits outscore bad edits, and tunes weights to minimize false
 * positives and false negatives.
 *
 * Usage: npx tsx scripts/voice-calibration/run-calibration.ts
 * Requires: OPENAI_API_KEY in .env.local or environment
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadEnvFile(file: string) {
  const p = resolve(process.cwd(), file);
  if (!existsSync(p)) return;
  try {
    const content = readFileSync(p, "utf-8");
    for (const line of content.split("\n")) {
      const eq = line.indexOf("=");
      if (eq < 0 || line.trim().startsWith("#")) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      process.env[key] = val;
    }
  } catch {}
}
loadEnvFile(".env.local");
loadEnvFile(".env");

import { CALIBRATION_DATASET, type CalibrationExample } from "./calibration-dataset";
import { extractFingerprint } from "../../convex/lib/voiceFingerprint";
import {
  computeStylisticScore,
  computeScopeScore,
  computeCombinedScore,
  semanticHeuristicPenalty,
  getWeightsForMode,
} from "../../convex/lib/voiceScoring";
import { getEmbeddings, embeddingCosineSimilarity } from "../../convex/lib/embeddings";
import type { EditorialMode } from "../../convex/lib/voiceTypes";

// ── Types ────────────────────────────────────────────────────────────────

type ScoreResult = {
  semanticScore: number;
  stylisticScore: number;
  scopeScore: number;
  combinedScore: number;
  clarityDelta: number; // readability change (suggestion - original)
};

type ExampleResult = {
  id: string;
  category: string;
  mode: EditorialMode;
  goodScores: ScoreResult;
  badScores: ScoreResult;
  goodWins: boolean; // good combined > bad combined
  goodWinsSemantic: boolean;
  goodWinsStylistic: boolean;
  goodWinsScope: boolean;
};

// ── Scoring (no profile: use original as author voice) ──────────────────────

async function scoreEdit(
  original: string,
  suggestion: string,
  mode: EditorialMode
): Promise<ScoreResult> {
  const origFp = extractFingerprint(original);
  const sugFp = extractFingerprint(suggestion);

  // Semantic: embeddings + heuristic penalty (or heuristic-only if SKIP_EMBEDDINGS)
  let semanticScore: number;
  if (SKIP_EMBEDDINGS) {
    semanticScore = semanticHeuristicPenalty(original, suggestion) * 0.9;
  } else {
    try {
      const embeddings = await getEmbeddings([original, suggestion]);
      const rawSemantic = embeddingCosineSimilarity(embeddings[0], embeddings[1]);
      const heuristicPenalty = semanticHeuristicPenalty(original, suggestion);
      semanticScore = rawSemantic * heuristicPenalty;
    } catch (err) {
      console.error("[embeddings] Fallback to heuristic only", err);
      semanticScore = semanticHeuristicPenalty(original, suggestion) * 0.85;
    }
  }

  // Stylistic: suggestion vs original (original = author voice)
  const stylisticScore = computeStylisticScore(sugFp, origFp);

  // Scope: structural compliance
  const scopeScore = computeScopeScore(origFp, sugFp, mode);

  // Combined
  const combinedScore = computeCombinedScore(
    { semanticScore, stylisticScore, scopeScore },
    mode
  );

  const clarityDelta = sugFp.readabilityScore - origFp.readabilityScore;

  return {
    semanticScore,
    stylisticScore,
    scopeScore,
    combinedScore,
    clarityDelta,
  };
}

// ── Batch scoring with rate limiting ───────────────────────────────────────

async function runCalibration(
  examples: CalibrationExample[],
  batchDelayMs: number = 100
): Promise<ExampleResult[]> {
  const results: ExampleResult[] = [];

  for (let i = 0; i < examples.length; i++) {
    const ex = examples[i];
    process.stderr.write(`\r[${i + 1}/${examples.length}] ${ex.id}...`);

    const [goodScores, badScores] = await Promise.all([
      scoreEdit(ex.original, ex.goodEdit, ex.editorialMode),
      scoreEdit(ex.original, ex.badEdit, ex.editorialMode),
    ]);

    results.push({
      id: ex.id,
      category: ex.category,
      mode: ex.editorialMode,
      goodScores,
      badScores,
      goodWins: goodScores.combinedScore > badScores.combinedScore,
      goodWinsSemantic: goodScores.semanticScore > badScores.semanticScore,
      goodWinsStylistic: goodScores.stylisticScore > badScores.stylisticScore,
      goodWinsScope: goodScores.scopeScore > badScores.scopeScore,
    });

    if (batchDelayMs > 0) {
      await new Promise((r) => setTimeout(r, batchDelayMs));
    }
  }

  process.stderr.write("\r" + " ".repeat(60) + "\r");
  return results;
}

// ── Validation & metrics ──────────────────────────────────────────────────

function computeMetrics(results: ExampleResult[]) {
  const total = results.length;
  const goodWins = results.filter((r) => r.goodWins).length;
  const goodWinsSemantic = results.filter((r) => r.goodWinsSemantic).length;
  const goodWinsStylistic = results.filter((r) => r.goodWinsStylistic).length;
  const goodWinsScope = results.filter((r) => r.goodWinsScope).length;

  // False negative: good edit scored LOWER than bad (we'd reject a good edit)
  const falseNegatives = results.filter((r) => !r.goodWins).length;
  // False positive: bad edit scored HIGHER than good (we'd accept a bad edit)
  const falsePositives = falseNegatives; // same set: when good loses, bad wins

  return {
    total,
    goodWinRate: goodWins / total,
    goodWins,
    goodWinsSemantic,
    goodWinsStylistic,
    goodWinsScope,
    falseNegatives,
    falsePositives,
    accuracy: goodWins / total,
  };
}

// ── Output ────────────────────────────────────────────────────────────────

function printResults(results: ExampleResult[], metrics: ReturnType<typeof computeMetrics>) {
  console.log("\n# Voice Scoring Calibration Results\n");

  console.log("## Summary\n");
  console.log(`Total examples: ${metrics.total}`);
  console.log(`Good edits outscore bad: ${metrics.goodWins}/${metrics.total} (${(metrics.goodWinRate * 100).toFixed(1)}%)`);
  console.log(`False negatives (good scored below bad): ${metrics.falseNegatives}`);
  console.log(`\nBy dimension:`);
  console.log(`  Semantic:  good > bad in ${metrics.goodWinsSemantic}/${metrics.total}`);
  console.log(`  Stylistic: good > bad in ${metrics.goodWinsStylistic}/${metrics.total}`);
  console.log(`  Scope:     good > bad in ${metrics.goodWinsScope}/${metrics.total}`);

  console.log("\n## Current Weights (by mode)\n");
  for (const mode of ["line", "developmental"] as EditorialMode[]) {
    const w = getWeightsForMode(mode);
    console.log(`  ${mode}: semantic=${w.semantic}, stylistic=${w.stylistic}, scope=${w.scope}`);
  }

  console.log("\n## Failures (good edit scored below bad)\n");
  const failures = results.filter((r) => !r.goodWins);
  if (failures.length === 0) {
    console.log("  None.");
  } else {
    for (const f of failures) {
      console.log(`  ${f.id} [${f.category}/${f.mode}]`);
      console.log(`    Good: sem=${f.goodScores.semanticScore.toFixed(3)} sty=${f.goodScores.stylisticScore.toFixed(3)} scope=${f.goodScores.scopeScore.toFixed(3)} combined=${f.goodScores.combinedScore.toFixed(3)}`);
      console.log(`    Bad:  sem=${f.badScores.semanticScore.toFixed(3)} sty=${f.badScores.stylisticScore.toFixed(3)} scope=${f.badScores.scopeScore.toFixed(3)} combined=${f.badScores.combinedScore.toFixed(3)}`);
    }
  }

  console.log("\n## Full Results (CSV-style)\n");
  console.log("id,category,mode,good_sem,good_sty,good_scope,good_comb,good_clarity,bad_sem,bad_sty,bad_scope,bad_comb,bad_clarity,good_wins");
  for (const r of results) {
    const row = [
      r.id,
      r.category,
      r.mode,
      r.goodScores.semanticScore.toFixed(4),
      r.goodScores.stylisticScore.toFixed(4),
      r.goodScores.scopeScore.toFixed(4),
      r.goodScores.combinedScore.toFixed(4),
      r.goodScores.clarityDelta.toFixed(2),
      r.badScores.semanticScore.toFixed(4),
      r.badScores.stylisticScore.toFixed(4),
      r.badScores.scopeScore.toFixed(4),
      r.badScores.combinedScore.toFixed(4),
      r.badScores.clarityDelta.toFixed(2),
      r.goodWins ? "1" : "0",
    ].join(",");
    console.log(row);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

const SKIP_EMBEDDINGS = process.env.SKIP_EMBEDDINGS === "true";

async function main() {
  if (!SKIP_EMBEDDINGS && !process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is required. Set it in .env.local or environment.");
    console.error("Or run with SKIP_EMBEDDINGS=true for heuristic-only semantic (no API calls).");
    process.exit(1);
  }
  if (SKIP_EMBEDDINGS) {
    console.log("SKIP_EMBEDDINGS=true: using heuristic-only semantic (no OpenAI calls)\n");
  }

  console.log("Voice Scoring Calibration");
  console.log("========================\n");
  console.log(`Dataset: ${CALIBRATION_DATASET.length} examples`);
  console.log("Running scoring engine (embeddings + fingerprint + scope)...\n");

  const results = await runCalibration(CALIBRATION_DATASET, 50);
  const metrics = computeMetrics(results);
  printResults(results, metrics);

  console.log("\n## By Category\n");
  const byCategory = new Map<string, ExampleResult[]>();
  for (const r of results) {
    const arr = byCategory.get(r.category) ?? [];
    arr.push(r);
    byCategory.set(r.category, arr);
  }
  for (const [cat, arr] of byCategory) {
    const wins = arr.filter((r) => r.goodWins).length;
    console.log(`  ${cat}: ${wins}/${arr.length} (${((wins / arr.length) * 100).toFixed(0)}%)`);
  }

  // ── Weight tuning ───────────────────────────────────────────────────────
  console.log("\n## Weight Tuning (data-driven)\n");
  const tuningResults = tuneWeights(results);
  printTuningResults(tuningResults);
}

// ── Weight tuning: grid search ─────────────────────────────────────────────

type WeightConfig = { semantic: number; stylistic: number; scope: number };

function combinedWithWeights(
  scores: ScoreResult,
  w: WeightConfig
): number {
  return (
    scores.semanticScore * w.semantic +
    scores.stylisticScore * w.stylistic +
    scores.scopeScore * w.scope
  );
}

function evaluateWeights(
  results: ExampleResult[],
  weights: Record<EditorialMode, WeightConfig>
): number {
  let wins = 0;
  for (const r of results) {
    const w = weights[r.mode];
    const goodComb = combinedWithWeights(r.goodScores, w);
    const badComb = combinedWithWeights(r.badScores, w);
    if (goodComb > badComb) wins++;
  }
  return wins / results.length;
}

function tuneWeights(results: ExampleResult[]) {
  const modes: EditorialMode[] = ["line", "developmental"];
  const steps = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5]; // semantic weights to try
  const best: { accuracy: number; weights: Record<EditorialMode, WeightConfig> } = {
    accuracy: 0,
    weights: { line: { semantic: 0.3, stylistic: 0.45, scope: 0.25 }, developmental: { semantic: 0.4, stylistic: 0.35, scope: 0.25 } },
  };

  for (const semLine of steps) {
    for (const scopeLine of [0.15, 0.2, 0.25, 0.3]) {
      const styLine = 1 - semLine - scopeLine;
      if (styLine < 0.1) continue;
      for (const semDev of steps) {
        for (const scopeDev of [0.15, 0.2, 0.25, 0.3]) {
          const styDev = 1 - semDev - scopeDev;
          if (styDev < 0.1) continue;
          const weights: Record<EditorialMode, WeightConfig> = {
            line: { semantic: semLine, stylistic: styLine, scope: scopeLine },
            developmental: { semantic: semDev, stylistic: styDev, scope: scopeDev },
          };
          const acc = evaluateWeights(results, weights);
          if (acc > best.accuracy) {
            best.accuracy = acc;
            best.weights = { ...weights };
          }
        }
      }
    }
  }

  return best;
}

function printTuningResults(tuning: { accuracy: number; weights: Record<EditorialMode, WeightConfig> }) {
  console.log(`Best accuracy: ${(tuning.accuracy * 100).toFixed(1)}%`);
  console.log(`Recommended weights:`);
  for (const [mode, w] of Object.entries(tuning.weights)) {
    console.log(`  ${mode}: semantic=${w.semantic.toFixed(2)}, stylistic=${w.stylistic.toFixed(2)}, scope=${w.scope.toFixed(2)}`);
  }
  console.log("\nApply these in convex/lib/voiceScoring.ts MODE_WEIGHTS if they outperform current.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
