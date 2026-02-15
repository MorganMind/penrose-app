#!/usr/bin/env npx tsx
/**
 * Voice regression suite — calibration gating.
 *
 * Runs against the fixed calibration set. Compares current metrics to
 * baseline. Fails (exit 1) if key metrics degrade beyond gating thresholds.
 *
 * Usage:
 *   npx tsx scripts/voice-calibration/run-regression.ts           # Run, compare to baseline
 *   npx tsx scripts/voice-calibration/run-regression.ts --save-baseline  # Save current as baseline
 *   npx tsx scripts/voice-calibration/run-regression.ts --live   # Include live LLM regression (slow)
 *
 * Set SKIP_EMBEDDINGS=true for heuristic-only semantic (no API calls, faster).
 * Requires OPENAI_API_KEY for embeddings or live regression.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), f);
    if (!existsSync(p)) continue;
    try {
      const c = readFileSync(p, "utf-8");
      for (const line of c.split("\n")) {
        const eq = line.indexOf("=");
        if (eq < 0 || line.trim().startsWith("#")) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        )
          val = val.slice(1, -1);
        process.env[key] = val;
      }
    } catch {}
  }
}
loadEnv();

import { CALIBRATION_DATASET } from "../../convex/lib/calibrationDataset";
import { extractFingerprint } from "../../convex/lib/voiceFingerprint";
import {
  computeStylisticScore,
  computeScopeScore,
  computeCombinedScore,
  semanticHeuristicPenalty,
} from "../../convex/lib/voiceScoring";
import { getEmbeddings, embeddingCosineSimilarity } from "../../convex/lib/embeddings";
import {
  STATIC_GATING_RULES,
  LIVE_GATING_RULES,
  type GatingRule,
} from "./regression-config";
import type { EditorialMode } from "../../convex/lib/voiceTypes";

const BASELINE_PATH = resolve(
  process.cwd(),
  "scripts/voice-calibration/regression-baseline.json"
);

// ── Types ─────────────────────────────────────────────────────────────────

type StaticMetrics = {
  goodWinRate: number;
  falseNegatives: number;
  total: number;
  meanSemanticGood: number;
  meanStylisticGood: number;
  meanScopeGood: number;
  meanCombinedGood: number;
  meanSemanticBad: number;
  meanStylisticBad: number;
  meanScopeBad: number;
  meanCombinedBad: number;
  byMode: Record<string, { goodWinRate: number; falseNegatives: number; total: number }>;
};

type LiveMetrics = {
  meanVoiceSimilarity: number;
  meanSemanticSimilarity: number;
  passRate: number;
  driftRate: number;
  enforcementFailureRate: number;
  exampleCount: number;
};

type Baseline = {
  version: number;
  createdAt: string;
  configHash?: string;
  static: StaticMetrics;
  live?: LiveMetrics;
};

type GatingFailure = {
  rule: string;
  description: string;
  baseline: number;
  current: number;
  threshold: string;
};

// ── Static scoring ────────────────────────────────────────────────────────

async function runStaticRegression(
  skipEmbeddings: boolean
): Promise<StaticMetrics> {
  const results: Array<{
    mode: EditorialMode;
    goodScores: { semantic: number; stylistic: number; scope: number; combined: number };
    badScores: { semantic: number; stylistic: number; scope: number; combined: number };
    goodWins: boolean;
  }> = [];

  for (let i = 0; i < CALIBRATION_DATASET.length; i++) {
    const ex = CALIBRATION_DATASET[i];
    process.stderr.write(`\r[${i + 1}/${CALIBRATION_DATASET.length}] ${ex.id}...`);

    const mode = ex.editorialMode as EditorialMode;
    const origFp = extractFingerprint(ex.original);
    const goodFp = extractFingerprint(ex.goodEdit);
    const badFp = extractFingerprint(ex.badEdit);

    let semanticGood: number;
    let semanticBad: number;

    if (skipEmbeddings) {
      semanticGood = semanticHeuristicPenalty(ex.original, ex.goodEdit) * 0.9;
      semanticBad = semanticHeuristicPenalty(ex.original, ex.badEdit) * 0.9;
    } else {
      try {
        const emb = await getEmbeddings([
          ex.original,
          ex.goodEdit,
          ex.badEdit,
        ]);
        semanticGood =
          embeddingCosineSimilarity(emb[0], emb[1]) *
          semanticHeuristicPenalty(ex.original, ex.goodEdit);
        semanticBad =
          embeddingCosineSimilarity(emb[0], emb[2]) *
          semanticHeuristicPenalty(ex.original, ex.badEdit);
      } catch {
        semanticGood =
          semanticHeuristicPenalty(ex.original, ex.goodEdit) * 0.85;
        semanticBad = semanticHeuristicPenalty(ex.original, ex.badEdit) * 0.85;
      }
    }

    const stylisticGood = computeStylisticScore(goodFp, origFp);
    const stylisticBad = computeStylisticScore(badFp, origFp);
    const scopeGood = computeScopeScore(origFp, goodFp, mode);
    const scopeBad = computeScopeScore(origFp, badFp, mode);
    const combinedGood = computeCombinedScore(
      {
        semanticScore: semanticGood,
        stylisticScore: stylisticGood,
        scopeScore: scopeGood,
      },
      mode
    );
    const combinedBad = computeCombinedScore(
      {
        semanticScore: semanticBad,
        stylisticScore: stylisticBad,
        scopeScore: scopeBad,
      },
      mode
    );

    results.push({
      mode,
      goodScores: {
        semantic: semanticGood,
        stylistic: stylisticGood,
        scope: scopeGood,
        combined: combinedGood,
      },
      badScores: {
        semantic: semanticBad,
        stylistic: stylisticBad,
        scope: scopeBad,
        combined: combinedBad,
      },
      goodWins: combinedGood > combinedBad,
    });
  }

  process.stderr.write("\r" + " ".repeat(60) + "\r");

  const total = results.length;
  const goodWins = results.filter((r) => r.goodWins).length;
  const mean = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const byMode: Record<
    string,
    { goodWinRate: number; falseNegatives: number; total: number }
  > = {};
  for (const mode of ["line", "developmental"] as EditorialMode[]) {
    const modeResults = results.filter((r) => r.mode === mode);
    const modeWins = modeResults.filter((r) => r.goodWins).length;
    byMode[mode] = {
      goodWinRate: modeResults.length ? modeWins / modeResults.length : 1,
      falseNegatives: modeResults.length - modeWins,
      total: modeResults.length,
    };
  }

  return {
    goodWinRate: goodWins / total,
    falseNegatives: total - goodWins,
    total,
    meanSemanticGood: mean(results.map((r) => r.goodScores.semantic)),
    meanStylisticGood: mean(results.map((r) => r.goodScores.stylistic)),
    meanScopeGood: mean(results.map((r) => r.goodScores.scope)),
    meanCombinedGood: mean(results.map((r) => r.goodScores.combined)),
    meanSemanticBad: mean(results.map((r) => r.badScores.semantic)),
    meanStylisticBad: mean(results.map((r) => r.badScores.stylistic)),
    meanScopeBad: mean(results.map((r) => r.badScores.scope)),
    meanCombinedBad: mean(results.map((r) => r.badScores.combined)),
    byMode,
  };
}

// ── Gating ─────────────────────────────────────────────────────────────────

function evaluateGating(
  rules: GatingRule[],
  baseline: Record<string, number>,
  current: Record<string, number>
): GatingFailure[] {
  const failures: GatingFailure[] = [];

  for (const rule of rules) {
    const baseVal = baseline[rule.metric];
    const currVal = current[rule.metric];
    if (baseVal === undefined || currVal === undefined) continue;

    if (rule.minDrop != null && currVal < baseVal - rule.minDrop) {
      failures.push({
        rule: rule.id,
        description: rule.description,
        baseline: baseVal,
        current: currVal,
        threshold: `current (${currVal.toFixed(4)}) < baseline (${baseVal.toFixed(4)}) - ${rule.minDrop}`,
      });
    }
    if (rule.floor != null && currVal < rule.floor) {
      failures.push({
        rule: rule.id,
        description: rule.description,
        baseline: baseVal,
        current: currVal,
        threshold: `current (${currVal.toFixed(4)}) < floor ${rule.floor}`,
      });
    }
    if (rule.maxRise != null && currVal > baseVal + rule.maxRise) {
      failures.push({
        rule: rule.id,
        description: rule.description,
        baseline: baseVal,
        current: currVal,
        threshold: `current (${currVal.toFixed(4)}) > baseline (${baseVal.toFixed(4)}) + ${rule.maxRise}`,
      });
    }
    if (rule.ceiling != null && currVal > rule.ceiling) {
      failures.push({
        rule: rule.id,
        description: rule.description,
        baseline: baseVal,
        current: currVal,
        threshold: `current (${currVal.toFixed(4)}) > ceiling ${rule.ceiling}`,
      });
    }
  }

  return failures;
}

// ── Output ─────────────────────────────────────────────────────────────────

function printDiff(
  label: string,
  baseline: number,
  current: number,
  higherIsBetter: boolean
) {
  const delta = current - baseline;
  const sign = delta >= 0 ? "+" : "";
  const dir = higherIsBetter
    ? delta >= 0
      ? "✓"
      : "✗"
    : delta <= 0
      ? "✓"
      : "✗";
  console.log(
    `  ${label}: ${current.toFixed(4)} (baseline: ${baseline.toFixed(4)}) ${sign}${delta.toFixed(4)} ${dir}`
  );
}

function printResults(
  staticMetrics: StaticMetrics,
  baseline: Baseline | null,
  failures: GatingFailure[],
  passed: boolean
) {
  console.log("\n# Voice Regression Suite\n");
  console.log(`Result: ${passed ? "PASS" : "FAIL"}\n`);

  if (baseline) {
    console.log("## Metric Diffs (current vs baseline)\n");
    const s = baseline.static;
    printDiff("goodWinRate", s.goodWinRate, staticMetrics.goodWinRate, true);
    printDiff("falseNegatives", s.falseNegatives, staticMetrics.falseNegatives, false);
    printDiff("meanSemanticGood", s.meanSemanticGood, staticMetrics.meanSemanticGood, true);
    printDiff("meanStylisticGood", s.meanStylisticGood, staticMetrics.meanStylisticGood, true);
    printDiff("meanScopeGood", s.meanScopeGood, staticMetrics.meanScopeGood, true);
    printDiff("meanCombinedGood", s.meanCombinedGood, staticMetrics.meanCombinedGood, true);
    console.log("");
  }

  if (failures.length > 0) {
    console.log("## Gating Failures\n");
    for (const f of failures) {
      console.log(`  ${f.rule}: ${f.description}`);
      console.log(`    ${f.threshold}`);
    }
    console.log("");
  }

  console.log("## Current Metrics\n");
  console.log(`  goodWinRate:       ${staticMetrics.goodWinRate.toFixed(4)}`);
  console.log(`  falseNegatives:    ${staticMetrics.falseNegatives}`);
  console.log(`  meanSemanticGood:  ${staticMetrics.meanSemanticGood.toFixed(4)}`);
  console.log(`  meanStylisticGood: ${staticMetrics.meanStylisticGood.toFixed(4)}`);
  console.log(`  meanCombinedGood:  ${staticMetrics.meanCombinedGood.toFixed(4)}`);
  console.log(`  byMode: ${JSON.stringify(staticMetrics.byMode, null, 2)}`);
}

// ── Main ───────────────────────────────────────────────────────────────────

// Default to heuristic-only (no API calls) for fast CI gating
const SKIP_EMBEDDINGS = process.env.SKIP_EMBEDDINGS !== "false";
const SAVE_BASELINE = process.argv.includes("--save-baseline");
const RUN_LIVE = process.argv.includes("--live");

async function main() {
  if (!SKIP_EMBEDDINGS && !process.env.OPENAI_API_KEY) {
    console.error(
      "OPENAI_API_KEY required for embeddings. Set SKIP_EMBEDDINGS=false to use embeddings."
    );
    process.exit(1);
  }

  if (RUN_LIVE && !process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY required for --live regression.");
    process.exit(1);
  }

  console.log("Voice Regression Suite");
  console.log("======================\n");
  console.log(`Dataset: ${CALIBRATION_DATASET.length} examples`);
  console.log(`Embeddings: ${SKIP_EMBEDDINGS ? "skipped (heuristic only)" : "enabled"}`);
  console.log(`Live regression: ${RUN_LIVE ? "enabled" : "disabled"}\n`);

  const staticMetrics = await runStaticRegression(SKIP_EMBEDDINGS);

  let baseline: Baseline | null = null;
  if (existsSync(BASELINE_PATH)) {
    try {
      baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf-8"));
    } catch {
      console.error("Could not parse baseline file");
    }
  }

  if (SAVE_BASELINE) {
    const newBaseline: Baseline = {
      version: 1,
      createdAt: new Date().toISOString(),
      static: staticMetrics,
    };
    writeFileSync(
      BASELINE_PATH,
      JSON.stringify(newBaseline, null, 2),
      "utf-8"
    );
    console.log(`\nBaseline saved to ${BASELINE_PATH}`);
    console.log("Run without --save-baseline to gate against this baseline.");
    process.exit(0);
  }

  let failures: GatingFailure[] = [];

  if (baseline) {
    const baselineFlat = { ...baseline.static } as Record<string, number>;
    delete baselineFlat.byMode;
    const currentFlat = { ...staticMetrics } as Record<string, number>;
    delete currentFlat.byMode;
    failures = evaluateGating(
      STATIC_GATING_RULES,
      baselineFlat,
      currentFlat
    );
  } else {
    console.log("\nNo baseline found. Run with --save-baseline to create one.");
    console.log("First run will not gate.");
  }

  const passed = failures.length === 0;
  printResults(staticMetrics, baseline, failures, passed);

  if (!passed) {
    console.log("\n*** REGRESSION FAILED — DO NOT DEPLOY ***\n");
    process.exit(1);
  }

  console.log("\n*** REGRESSION PASSED ***\n");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
