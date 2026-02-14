#!/usr/bin/env npx tsx
/**
 * Multi-variant vs single-pass validation.
 *
 * Proves that multi-variant selection improves consistency by comparing:
 * - Average voice similarity (stylistic score)
 * - Variance between reruns (lower = more stable)
 * - Enforcement trigger frequency (drift/soft_warning/failure)
 *
 * Multi-variant should reduce variance and reduce drift incidents measurably.
 *
 * Usage: npx tsx scripts/voice-calibration/validate-multi-variant.ts
 * Requires: OPENAI_API_KEY
 */

import { readFileSync, existsSync } from "fs";
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
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
          val = val.slice(1, -1);
        process.env[key] = val;
      }
    } catch {}
  }
}
loadEnv();

import { CALIBRATION_DATASET } from "./calibration-dataset";
import { EDITORIAL_MODES, augmentPromptWithPreferences } from "../../convex/lib/prompts";
import { getVariationPair } from "../../convex/lib/candidateVariations";
import { computeSelectionScore } from "../../convex/lib/candidateSelection";
import { classify } from "../../convex/lib/voiceEnforcement";
import { extractFingerprint } from "../../convex/lib/voiceFingerprint";
import {
  computeStylisticScore,
  computeScopeScore,
  computeCombinedScore,
  semanticHeuristicPenalty,
} from "../../convex/lib/voiceScoring";
import { getEmbeddings, embeddingCosineSimilarity } from "../../convex/lib/embeddings";
import type { EditorialMode } from "../../convex/lib/voiceTypes";

// ── Model call ─────────────────────────────────────────────────────────────

async function callModel(params: {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY required");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL ?? "gpt-4o-mini",
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt },
      ],
      temperature: params.temperature,
    }),
  });

  if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Unexpected response");
  return content.trim();
}

// ── Scoring ───────────────────────────────────────────────────────────────

type Scores = {
  semantic: number;
  stylistic: number;
  scope: number;
  combined: number;
  enforcementClass: "pass" | "soft_warning" | "failure" | "drift";
};

async function scoreOutput(
  original: string,
  output: string,
  mode: EditorialMode
): Promise<Scores> {
  const origFp = extractFingerprint(original);
  const outFp = extractFingerprint(output);

  let semantic: number;
  try {
    const emb = await getEmbeddings([original, output]);
    const raw = embeddingCosineSimilarity(emb[0], emb[1]);
    semantic = raw * semanticHeuristicPenalty(original, output);
  } catch {
    semantic = semanticHeuristicPenalty(original, output) * 0.9;
  }

  const stylistic = computeStylisticScore(outFp, origFp);
  const scope = computeScopeScore(origFp, outFp, mode);
  const combined = computeCombinedScore(
    { semanticScore: semantic, stylisticScore: stylistic, scopeScore: scope },
    mode
  );
  const enforcementClass = classify(combined, semantic, mode);

  return { semantic, stylistic, scope, combined, enforcementClass };
}

// ── Single-pass: 1 call, score ─────────────────────────────────────────────

async function singlePass(
  original: string,
  mode: EditorialMode,
  seed: number
): Promise<Scores> {
  const config = EDITORIAL_MODES[mode];
  const basePrompt = augmentPromptWithPreferences(config.systemPrompt, null);
  const [variation] = getVariationPair(mode as "line" | "developmental", seed);
  const prompt = basePrompt + "\n\n" + variation.suffix;

  const output = await callModel({
    systemPrompt: prompt,
    userPrompt: original,
    temperature: config.modelConfig.temperature,
  });

  return scoreOutput(original, output, mode);
}

// ── Multi-variant: 2 calls, pick best by selection score ──────────────────

async function multiVariant(
  original: string,
  mode: EditorialMode,
  seed: number
): Promise<{ scores: Scores; winnerIndex: number; allScores: Scores[] }> {
  const config = EDITORIAL_MODES[mode];
  const basePrompt = augmentPromptWithPreferences(config.systemPrompt, null);
  const [varA, varB] = getVariationPair(mode as "line" | "developmental", seed);

  const [outA, outB] = await Promise.all([
    callModel({
      systemPrompt: basePrompt + "\n\n" + varA.suffix,
      userPrompt: original,
      temperature: config.modelConfig.temperature,
    }),
    callModel({
      systemPrompt: basePrompt + "\n\n" + varB.suffix,
      userPrompt: original,
      temperature: config.modelConfig.temperature,
    }),
  ]);

  const [scoresA, scoresB] = await Promise.all([
    scoreOutput(original, outA, mode),
    scoreOutput(original, outB, mode),
  ]);

  const selA = computeSelectionScore({
    semanticScore: scoresA.semantic,
    stylisticScore: scoresA.stylistic,
    scopeScore: scoresA.scope,
    combinedScore: scoresA.combined,
  });
  const selB = computeSelectionScore({
    semanticScore: scoresB.semantic,
    stylisticScore: scoresB.stylistic,
    scopeScore: scoresB.scope,
    combinedScore: scoresB.combined,
  });

  const winnerIndex = selA >= selB ? 0 : 1;
  const winner = winnerIndex === 0 ? scoresA : scoresB;

  return {
    scores: winner,
    winnerIndex,
    allScores: [scoresA, scoresB],
  };
}

// ── Stats ──────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  return Math.sqrt(variance(arr));
}

// ── Main ──────────────────────────────────────────────────────────────────

const RERUNS = 3;
const EXAMPLES = 12; // subset for cost control

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY required");
    process.exit(1);
  }

  const subset = CALIBRATION_DATASET.filter(
    (e) => e.editorialMode === "line" || e.editorialMode === "developmental"
  ).slice(0, EXAMPLES);

  console.log("Multi-Variant vs Single-Pass Validation\n");
  console.log(`Examples: ${subset.length}, Reruns: ${RERUNS}\n`);

  const singleResults: Scores[][] = [];
  const multiResults: Scores[][] = [];
  const multiAllCandidates: Scores[][] = [];

  for (let i = 0; i < subset.length; i++) {
    const ex = subset[i];
    const mode = ex.editorialMode as EditorialMode;
    process.stderr.write(`\r[${i + 1}/${subset.length}] ${ex.id}...`);

    const singleReruns: Scores[] = [];
    const multiReruns: Scores[] = [];
    const multiCandidates: Scores[] = [];

    for (let r = 0; r < RERUNS; r++) {
      const [s, m] = await Promise.all([
        singlePass(ex.original, mode, i * 100 + r),
        multiVariant(ex.original, mode, i * 100 + r),
      ]);
      singleReruns.push(s);
      multiReruns.push(m.scores);
      multiCandidates.push(...m.allScores);
    }

    singleResults.push(singleReruns);
    multiResults.push(multiReruns);
    multiAllCandidates.push(multiCandidates);

    await new Promise((r) => setTimeout(r, 200));
  }

  process.stderr.write("\r" + " ".repeat(50) + "\r");

  // ── Aggregate metrics ────────────────────────────────────────────────────

  const flatSingle = singleResults.flat();
  const flatMulti = multiResults.flat();

  const singleStylistic = flatSingle.map((s) => s.stylistic);
  const multiStylistic = flatMulti.map((s) => s.stylistic);

  const singleCombined = flatSingle.map((s) => s.combined);
  const multiCombined = flatMulti.map((s) => s.combined);

  const singleEnforcement = flatSingle.map((s) => s.enforcementClass);
  const multiEnforcement = flatMulti.map((s) => s.enforcementClass);

  const enforcementTriggers = (arr: string[]) =>
    arr.filter((c) => c !== "pass").length;

  // Per-example variance (across reruns)
  const singleVariances = singleResults.map((reruns) =>
    variance(reruns.map((r) => r.stylistic))
  );
  const multiVariances = multiResults.map((reruns) =>
    variance(reruns.map((r) => r.stylistic))
  );

  // ── Report ───────────────────────────────────────────────────────────────

  console.log("## Results\n");

  console.log("### Average Voice Similarity (stylistic score, higher = better)\n");
  console.log(`  Single-pass:  ${mean(singleStylistic).toFixed(4)}`);
  console.log(`  Multi-variant: ${mean(multiStylistic).toFixed(4)}`);
  const stylisticImprovement =
    ((mean(multiStylistic) - mean(singleStylistic)) / mean(singleStylistic)) *
    100;
  console.log(
    `  Δ: ${stylisticImprovement >= 0 ? "+" : ""}${stylisticImprovement.toFixed(1)}%\n`
  );

  console.log("### Variance Between Reruns (lower = more stable)\n");
  console.log(`  Single-pass std dev (stylistic):  ${stdDev(singleStylistic).toFixed(4)}`);
  console.log(`  Multi-variant std dev (stylistic): ${stdDev(multiStylistic).toFixed(4)}`);
  const singleAvgVar = mean(singleVariances);
  const multiAvgVar = mean(multiVariances);
  console.log(`  Single avg per-example variance:  ${singleAvgVar.toFixed(6)}`);
  console.log(`  Multi avg per-example variance:   ${multiAvgVar.toFixed(6)}`);
  const varReduction =
    singleAvgVar > 0 ? ((singleAvgVar - multiAvgVar) / singleAvgVar) * 100 : 0;
  console.log(
    `  Variance reduction: ${varReduction >= 0 ? "" : "-"}${Math.abs(varReduction).toFixed(1)}%\n`
  );

  console.log("### Enforcement Trigger Frequency\n");
  const singleTriggers = enforcementTriggers(singleEnforcement);
  const multiTriggers = enforcementTriggers(multiEnforcement);
  console.log(`  Single-pass:  ${singleTriggers}/${flatSingle.length} (${((singleTriggers / flatSingle.length) * 100).toFixed(1)}%)`);
  console.log(`  Multi-variant: ${multiTriggers}/${flatMulti.length} (${((multiTriggers / flatMulti.length) * 100).toFixed(1)}%)`);
  const driftSingle = singleEnforcement.filter((c) => c === "drift").length;
  const driftMulti = multiEnforcement.filter((c) => c === "drift").length;
  console.log(`  Drift incidents - Single: ${driftSingle}, Multi: ${driftMulti}\n`);

  console.log("### Combined Score\n");
  console.log(`  Single-pass:  ${mean(singleCombined).toFixed(4)}`);
  console.log(`  Multi-variant: ${mean(multiCombined).toFixed(4)}\n`);

  // ── Verdict ──────────────────────────────────────────────────────────────

  console.log("## Verdict\n");
  const multiWinsStylistic = mean(multiStylistic) >= mean(singleStylistic);
  const multiLowerVariance = multiAvgVar <= singleAvgVar;
  const multiFewerTriggers = multiTriggers <= singleTriggers;
  const multiFewerDrift = driftMulti <= driftSingle;

  console.log(`  Multi-variant improves avg voice similarity: ${multiWinsStylistic ? "✓" : "✗"}`);
  console.log(`  Multi-variant reduces variance: ${multiLowerVariance ? "✓" : "✗"}`);
  console.log(`  Multi-variant reduces enforcement triggers: ${multiFewerTriggers ? "✓" : "✗"}`);
  console.log(`  Multi-variant reduces drift incidents: ${multiFewerDrift ? "✓" : "✗"}`);

  const materialImprovement =
    multiWinsStylistic && (multiLowerVariance || multiFewerTriggers);
  console.log(
    `\n  Material improvement: ${materialImprovement ? "YES" : "NO"}`
  );

  if (!materialImprovement) {
    console.log(
      "\n  → Consider: reduce candidate count or adjust selection weights. Do not add more candidates blindly."
    );
  }

  // ── Raw data for analysis ────────────────────────────────────────────────
  console.log("\n## Raw Data (per-example, per-rerun)\n");
  console.log("example_id,mode,rerun,strategy,stylistic,combined,enforcement_class");
  for (let i = 0; i < subset.length; i++) {
    const ex = subset[i];
    for (let r = 0; r < RERUNS; r++) {
      console.log(
        `${ex.id},${ex.editorialMode},${r},single,${singleResults[i][r].stylistic.toFixed(4)},${singleResults[i][r].combined.toFixed(4)},${singleResults[i][r].enforcementClass}`
      );
      console.log(
        `${ex.id},${ex.editorialMode},${r},multi,${multiResults[i][r].stylistic.toFixed(4)},${multiResults[i][r].combined.toFixed(4)},${multiResults[i][r].enforcementClass}`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
