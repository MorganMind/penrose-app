"use node";

/**
 * Voice regression suite — Convex integration.
 *
 * Stores baseline, runs static regression, compares to baseline,
 * and records run history. Used by the run-regression script and
 * the internal admin route.
 */

import { action, internalAction } from "./_generated/server";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { createHash } from "crypto";
import { CALIBRATION_DATASET } from "./lib/calibrationDataset";
import { extractFingerprint } from "./lib/voiceFingerprint";
import { getWeightsForMode } from "./lib/voiceScoring";
import { EDITORIAL_MODES } from "./lib/prompts";
import { requireUser } from "./access";
import {
  computeStylisticScore,
  computeScopeScore,
  computeCombinedScore,
  semanticHeuristicPenalty,
} from "./lib/voiceScoring";
import { getEmbeddings, embeddingCosineSimilarity } from "./lib/embeddings";
import type { EditorialMode } from "./lib/voiceTypes";

// ── Config hash (prompts + weights + model) ────────────────────────────────

function computeConfigHash(): string {
  const model = process.env.AI_MODEL ?? "gpt-4o-mini";
  const provider = process.env.AI_PROVIDER ?? "openai";

  const payload = JSON.stringify({
    weights: {
      line: getWeightsForMode("line"),
      developmental: getWeightsForMode("developmental"),
      copy: getWeightsForMode("copy"),
    },
    promptHashes: Object.fromEntries(
      Object.entries(EDITORIAL_MODES).map(([k, v]) => [
        k,
        createHash("sha256")
          .update((v as { systemPrompt: string }).systemPrompt)
          .digest("hex")
          .slice(0, 12),
      ])
    ),
    model,
    provider,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

// ── Static scoring (no LLM) ───────────────────────────────────────────────

type StaticResult = {
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

async function runStaticRegression(
  skipEmbeddings: boolean
): Promise<StaticResult> {
  const results: Array<{
    id: string;
    mode: EditorialMode;
    goodScores: { semantic: number; stylistic: number; scope: number; combined: number };
    badScores: { semantic: number; stylistic: number; scope: number; combined: number };
    goodWins: boolean;
  }> = [];

  for (const ex of CALIBRATION_DATASET) {
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
        semanticGood = semanticHeuristicPenalty(ex.original, ex.goodEdit) * 0.85;
        semanticBad = semanticHeuristicPenalty(ex.original, ex.badEdit) * 0.85;
      }
    }

    const stylisticGood = computeStylisticScore(goodFp, origFp);
    const stylisticBad = computeStylisticScore(badFp, origFp);
    const scopeGood = computeScopeScore(origFp, goodFp, mode);
    const scopeBad = computeScopeScore(origFp, badFp, mode);
    const combinedGood = computeCombinedScore(
      { semanticScore: semanticGood, stylisticScore: stylisticGood, scopeScore: scopeGood },
      mode
    );
    const combinedBad = computeCombinedScore(
      { semanticScore: semanticBad, stylisticScore: stylisticBad, scopeScore: scopeBad },
      mode
    );

    results.push({
      id: ex.id,
      mode,
      goodScores: { semantic: semanticGood, stylistic: stylisticGood, scope: scopeGood, combined: combinedGood },
      badScores: { semantic: semanticBad, stylistic: stylisticBad, scope: scopeBad, combined: combinedBad },
      goodWins: combinedGood > combinedBad,
    });
  }

  const total = results.length;
  const goodWins = results.filter((r) => r.goodWins).length;
  const falseNegatives = total - goodWins;

  const goodSem = results.map((r) => r.goodScores.semantic);
  const goodSty = results.map((r) => r.goodScores.stylistic);
  const goodScp = results.map((r) => r.goodScores.scope);
  const goodCmb = results.map((r) => r.goodScores.combined);
  const badSem = results.map((r) => r.badScores.semantic);
  const badSty = results.map((r) => r.badScores.stylistic);
  const badScp = results.map((r) => r.badScores.scope);
  const badCmb = results.map((r) => r.badScores.combined);

  const mean = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const byMode: Record<string, { goodWinRate: number; falseNegatives: number; total: number }> = {};
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
    falseNegatives,
    total,
    meanSemanticGood: mean(goodSem),
    meanStylisticGood: mean(goodSty),
    meanScopeGood: mean(goodScp),
    meanCombinedGood: mean(goodCmb),
    meanSemanticBad: mean(badSem),
    meanStylisticBad: mean(badSty),
    meanScopeBad: mean(badScp),
    meanCombinedBad: mean(badCmb),
    byMode,
  };
}

// ── Queries ────────────────────────────────────────────────────────────────

export const getBaseline = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db
      .query("voiceRegressionBaseline")
      .order("desc")
      .first();
  },
});

export const getRecentRuns = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 10 }) => {
    await requireUser(ctx);
    return await ctx.db
      .query("voiceRegressionRuns")
      .order("desc")
      .take(limit ?? 10);
  },
});

// ── Internal: set baseline (called after manual verification) ──────────────

/**
 * Save current run metrics as baseline (admin only).
 * Call after verifying a good run.
 */
export const saveBaselineFromRun = action({
  args: {
    static: v.object({
      goodWinRate: v.number(),
      falseNegatives: v.number(),
      total: v.number(),
      meanSemanticGood: v.number(),
      meanStylisticGood: v.number(),
      meanScopeGood: v.number(),
      meanCombinedGood: v.number(),
      meanSemanticBad: v.number(),
      meanStylisticBad: v.number(),
      meanScopeBad: v.number(),
      meanCombinedBad: v.number(),
      byMode: v.optional(v.any()),
    }),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    await ctx.runMutation(internal.voiceRegression.setBaseline, {
      static: args.static,
      createdBy: "admin",
    });
  },
});

export const setBaseline = internalMutation({
  args: {
    static: v.object({
      goodWinRate: v.number(),
      falseNegatives: v.number(),
      total: v.number(),
      meanSemanticGood: v.number(),
      meanStylisticGood: v.number(),
      meanScopeGood: v.number(),
      meanCombinedGood: v.number(),
      meanSemanticBad: v.number(),
      meanStylisticBad: v.number(),
      meanScopeBad: v.number(),
      meanCombinedBad: v.number(),
      byMode: v.optional(v.any()),
    }),
    live: v.optional(v.any()),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const configHash = computeConfigHash();
    return await ctx.db.insert("voiceRegressionBaseline", {
      configHash,
      createdAt: Date.now(),
      createdBy: args.createdBy,
      static: args.static,
      live: args.live,
    });
  },
});

// ── Action: run regression and compare to baseline ──────────────────────────

const GATING_RULES = [
  { id: "good_win_rate", metric: "goodWinRate", minDrop: 0.05, floor: 0.85 },
  { id: "false_negatives", metric: "falseNegatives", maxRise: 3 },
  { id: "mean_voice_good", metric: "meanStylisticGood", minDrop: 0.05, floor: 0.7 },
  { id: "mean_semantic_good", metric: "meanSemanticGood", minDrop: 0.05, floor: 0.75 },
  { id: "mean_combined_good", metric: "meanCombinedGood", minDrop: 0.05, floor: 0.7 },
];

/**
 * Public action to run regression (for admin route).
 * Calls the internal action and returns the result.
 */
export const runRegressionAction = action({
  args: {
    skipEmbeddings: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    return await ctx.runAction(internal.voiceRegression.runRegression, {
      skipEmbeddings: args.skipEmbeddings ?? true,
    });
  },
});

export const runRegression = internalAction({
  args: {
    skipEmbeddings: v.optional(v.boolean()),
  },
  handler: async (ctx, { skipEmbeddings = true }) => {
    const configHash = computeConfigHash();
    const staticResult = await runStaticRegression(skipEmbeddings ?? true);

    const baseline = await ctx.runQuery(
      internal.voiceRegression.getBaselineInternal
    );

    const failures: Array<{
      rule: string;
      baseline: number;
      current: number;
      threshold: string;
    }> = [];

    if (baseline) {
      for (const rule of GATING_RULES) {
        const baseVal = (baseline.static as Record<string, number>)[rule.metric];
        const currVal = (staticResult as Record<string, number>)[rule.metric];
        if (baseVal === undefined || currVal === undefined) continue;

        if (rule.minDrop != null && currVal < baseVal - rule.minDrop) {
          failures.push({
            rule: rule.id,
            baseline: baseVal,
            current: currVal,
            threshold: `current (${currVal.toFixed(4)}) < baseline (${baseVal.toFixed(4)}) - ${rule.minDrop}`,
          });
        }
        if (rule.floor != null && currVal < rule.floor) {
          failures.push({
            rule: rule.id,
            baseline: baseVal,
            current: currVal,
            threshold: `current (${currVal.toFixed(4)}) < floor ${rule.floor}`,
          });
        }
        if (rule.maxRise != null && currVal > baseVal + rule.maxRise) {
          failures.push({
            rule: rule.id,
            baseline: baseVal,
            current: currVal,
            threshold: `current (${currVal.toFixed(4)}) > baseline (${baseVal.toFixed(4)}) + ${rule.maxRise}`,
          });
        }
      }
    }

    const passed = failures.length === 0;

    await ctx.runMutation(internal.voiceRegression.recordRun, {
      passed,
      configHash,
      staticOnly: true,
      static: {
        goodWinRate: staticResult.goodWinRate,
        falseNegatives: staticResult.falseNegatives,
        total: staticResult.total,
        meanSemanticGood: staticResult.meanSemanticGood,
        meanStylisticGood: staticResult.meanStylisticGood,
        meanScopeGood: staticResult.meanScopeGood,
        meanCombinedGood: staticResult.meanCombinedGood,
      },
      failures,
      failuresDetail:
        failures.length > 0
          ? failures.map((f) => `${f.rule}: ${f.threshold}`).join("; ")
          : undefined,
    });

    return {
      passed,
      configHash,
      static: staticResult,
      failures,
      baseline: baseline
        ? {
            configHash: baseline.configHash,
            createdAt: baseline.createdAt,
            static: baseline.static,
          }
        : null,
    };
  },
});

// ── Internal helpers ───────────────────────────────────────────────────────

export const getBaselineInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("voiceRegressionBaseline")
      .order("desc")
      .first();
  },
});

export const recordRun = internalMutation({
  args: {
    passed: v.boolean(),
    configHash: v.string(),
    staticOnly: v.boolean(),
    static: v.object({
      goodWinRate: v.number(),
      falseNegatives: v.number(),
      total: v.number(),
      meanSemanticGood: v.number(),
      meanStylisticGood: v.number(),
      meanScopeGood: v.number(),
      meanCombinedGood: v.number(),
    }),
    live: v.optional(v.any()),
    failures: v.array(
      v.object({
        rule: v.string(),
        baseline: v.number(),
        current: v.number(),
        threshold: v.string(),
      })
    ),
    failuresDetail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("voiceRegressionRuns", {
      ...args,
      createdAt: Date.now(),
    });
  },
});
