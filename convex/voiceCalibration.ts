import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./access";

// ── Helpers ──────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

type DimensionKey = "semantic" | "stylistic" | "scope" | "combined";
const DIMENSIONS: DimensionKey[] = [
  "semantic",
  "stylistic",
  "scope",
  "combined",
];

const SCORE_FIELDS: Record<DimensionKey, string> = {
  semantic: "semanticScore",
  stylistic: "stylisticScore",
  scope: "scopeScore",
  combined: "combinedScore",
};

type Mode = "developmental" | "line" | "copy";
const MODES: Mode[] = ["developmental", "line", "copy"];

// ── Score Distributions ──────────────────────────────────────────────────────

export const getScoreDistributions = query({
  args: {
    includeUnenforced: v.optional(v.boolean()),
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
  },
  handler: async (ctx, { includeUnenforced, dateFrom, dateTo }) => {
    await requireUser(ctx);

    let all = await ctx.db.query("voiceEvaluations").collect();
    if (dateFrom) all = all.filter((e) => e.createdAt >= dateFrom);
    if (dateTo) all = all.filter((e) => e.createdAt <= dateTo);
    const evals = includeUnenforced ? all : all.filter((e) => e.enforced);

    const result: Record<
      string,
      Record<
        string,
        {
          p10: number;
          p25: number;
          p50: number;
          p75: number;
          p90: number;
          min: number;
          max: number;
          mean: number;
          stddev: number;
          count: number;
        }
      >
    > = {};

    for (const mode of MODES) {
      result[mode] = {};
      const modeEvals = evals.filter((e) => e.editorialMode === mode);

      for (const dim of DIMENSIONS) {
        const field = SCORE_FIELDS[dim] as keyof (typeof modeEvals)[0];
        const values = modeEvals
          .map((e) => e[field] as number)
          .filter((v) => typeof v === "number")
          .sort((a, b) => a - b);

        result[mode][dim] = {
          p10: percentile(values, 10),
          p25: percentile(values, 25),
          p50: percentile(values, 50),
          p75: percentile(values, 75),
          p90: percentile(values, 90),
          min: values.length > 0 ? values[0] : 0,
          max: values.length > 0 ? values[values.length - 1] : 0,
          mean: mean(values),
          stddev: stddev(values),
          count: values.length,
        };
      }
    }

    result["all"] = {};
    for (const dim of DIMENSIONS) {
      const field = SCORE_FIELDS[dim] as keyof (typeof evals)[0];
      const values = evals
        .map((e) => e[field] as number)
        .filter((v) => typeof v === "number")
        .sort((a, b) => a - b);

      result["all"][dim] = {
        p10: percentile(values, 10),
        p25: percentile(values, 25),
        p50: percentile(values, 50),
        p75: percentile(values, 75),
        p90: percentile(values, 90),
        min: values.length > 0 ? values[0] : 0,
        max: values.length > 0 ? values[values.length - 1] : 0,
        mean: mean(values),
        stddev: stddev(values),
        count: values.length,
      };
    }

    return result;
  },
});

// ── Score tuples for client-side threshold simulation ────────────────────────

export const getEvaluationScoresForSimulation = query({
  args: {
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
  },
  handler: async (ctx, { dateFrom, dateTo }) => {
    await requireUser(ctx);

    let all = await ctx.db.query("voiceEvaluations").collect();
    if (dateFrom) all = all.filter((e) => e.createdAt >= dateFrom);
    if (dateTo) all = all.filter((e) => e.createdAt <= dateTo);

    type ScoreTuple = {
      id: string;
      semantic: number;
      stylistic: number;
      scope: number;
      combined: number;
      passed: boolean;
      enforced: boolean;
      thresholds: {
        semantic: number;
        stylistic: number;
        scope: number;
        combined: number;
      };
      originalPreview: string;
    };

    const byMode: Record<string, ScoreTuple[]> = {
      developmental: [],
      line: [],
      copy: [],
    };

    for (const e of all) {
      const tuple: ScoreTuple = {
        id: e._id,
        semantic: e.semanticScore,
        stylistic: e.stylisticScore,
        scope: e.scopeScore,
        combined: e.combinedScore,
        passed: e.passed,
        enforced: e.enforced,
        thresholds: e.thresholds,
        originalPreview: e.originalPreview,
      };
      const arr = byMode[e.editorialMode];
      if (arr) arr.push(tuple);
    }

    return byMode;
  },
});

// ── Threshold Simulation (server-side fallback; prefer client-side) ───────────

export const simulateThresholds = query({
  args: {
    proposed: v.object({
      semantic: v.number(),
      stylistic: v.number(),
      scope: v.number(),
      combined: v.number(),
    }),
    modeFilter: v.optional(
      v.union(
        v.literal("developmental"),
        v.literal("line"),
        v.literal("copy")
      )
    ),
  },
  handler: async (ctx, { proposed, modeFilter }) => {
    await requireUser(ctx);

    let evals = await ctx.db.query("voiceEvaluations").collect();
    evals = evals.filter((e) => e.enforced);

    if (modeFilter) {
      evals = evals.filter((e) => e.editorialMode === modeFilter);
    }

    let currentPass = 0;
    let proposedPass = 0;

    const flips: Array<{
      _id: string;
      direction: "pass_to_fail" | "fail_to_pass";
      mode: string;
      scores: {
        semantic: number;
        stylistic: number;
        scope: number;
        combined: number;
      };
      currentThresholds: {
        semantic: number;
        stylistic: number;
        scope: number;
        combined: number;
      };
      failedDimensions: string[];
      createdAt: number;
      originalPreview: string;
    }> = [];

    for (const e of evals) {
      const currentPassed = e.passed;

      const proposedPassed =
        e.semanticScore >= proposed.semantic &&
        e.stylisticScore >= proposed.stylistic &&
        e.scopeScore >= proposed.scope &&
        e.combinedScore >= proposed.combined;

      if (currentPassed) currentPass++;
      if (proposedPassed) proposedPass++;

      if (currentPassed !== proposedPassed) {
        const failedDims: string[] = [];
        if (e.semanticScore < proposed.semantic) failedDims.push("semantic");
        if (e.stylisticScore < proposed.stylistic)
          failedDims.push("stylistic");
        if (e.scopeScore < proposed.scope) failedDims.push("scope");
        if (e.combinedScore < proposed.combined) failedDims.push("combined");

        flips.push({
          _id: e._id,
          direction: currentPassed ? "pass_to_fail" : "fail_to_pass",
          mode: e.editorialMode,
          scores: {
            semantic: e.semanticScore,
            stylistic: e.stylisticScore,
            scope: e.scopeScore,
            combined: e.combinedScore,
          },
          currentThresholds: e.thresholds,
          failedDimensions: failedDims,
          createdAt: e.createdAt,
          originalPreview: e.originalPreview,
        });
      }
    }

    return {
      total: evals.length,
      current: {
        pass: currentPass,
        fail: evals.length - currentPass,
        rate: evals.length > 0 ? currentPass / evals.length : 1,
      },
      proposed: {
        pass: proposedPass,
        fail: evals.length - proposedPass,
        rate: evals.length > 0 ? proposedPass / evals.length : 1,
      },
      netChange: proposedPass - currentPass,
      flips: flips.sort((a, b) => b.createdAt - a.createdAt),
    };
  },
});

// ── Failure Dimension Analysis ───────────────────────────────────────────────

export const getFailureBreakdown = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);

    const evals = await ctx.db.query("voiceEvaluations").collect();

    const enforced = evals.filter((e) => e.enforced);
    const failed = enforced.filter((e) => !e.passed);

    type ModeBreakdown = {
      total: number;
      enforced: number;
      failed: number;
      semanticOnly: number;
      stylisticOnly: number;
      scopeOnly: number;
      combinedOnly: number;
      multiDimension: number;
      semanticTotal: number;
      stylisticTotal: number;
      scopeTotal: number;
      failurePatterns: Record<string, number>;
    };

    const initBreakdown = (): ModeBreakdown => ({
      total: 0,
      enforced: 0,
      failed: 0,
      semanticOnly: 0,
      stylisticOnly: 0,
      scopeOnly: 0,
      combinedOnly: 0,
      multiDimension: 0,
      semanticTotal: 0,
      stylisticTotal: 0,
      scopeTotal: 0,
      failurePatterns: {},
    });

    const byMode: Record<string, ModeBreakdown> = {
      developmental: initBreakdown(),
      line: initBreakdown(),
      copy: initBreakdown(),
      all: initBreakdown(),
    };

    for (const e of evals) {
      const targets = [byMode[e.editorialMode], byMode.all];
      for (const t of targets) {
        if (!t) continue;
        t.total++;
      }
    }

    for (const e of enforced) {
      const targets = [byMode[e.editorialMode], byMode.all];
      for (const t of targets) {
        if (!t) continue;
        t.enforced++;
      }
    }

    for (const e of failed) {
      const dims: string[] = [];
      if (e.semanticScore < e.thresholds.semantic) dims.push("semantic");
      if (e.stylisticScore < e.thresholds.stylistic) dims.push("stylistic");
      if (e.scopeScore < e.thresholds.scope) dims.push("scope");

      const combinedAloneFailed =
        dims.length === 0 && e.combinedScore < e.thresholds.combined;

      const targets = [byMode[e.editorialMode], byMode.all];
      for (const t of targets) {
        if (!t) continue;
        t.failed++;

        if (dims.includes("semantic")) t.semanticTotal++;
        if (dims.includes("stylistic")) t.stylisticTotal++;
        if (dims.includes("scope")) t.scopeTotal++;

        if (combinedAloneFailed) {
          t.combinedOnly++;
        } else if (dims.length === 1) {
          if (dims[0] === "semantic") t.semanticOnly++;
          else if (dims[0] === "stylistic") t.stylisticOnly++;
          else if (dims[0] === "scope") t.scopeOnly++;
        } else {
          t.multiDimension++;
        }

        const pattern = combinedAloneFailed
          ? "combined_only"
          : dims.sort().join("+");
        t.failurePatterns[pattern] = (t.failurePatterns[pattern] ?? 0) + 1;
      }
    }

    return byMode;
  },
});

// ── Model / Prompt Version Drift ─────────────────────────────────────────────

export const getModelVersionStats = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);

    const evals = await ctx.db.query("voiceEvaluations").collect();

    type VersionGroup = {
      provider: string;
      model: string;
      promptVersion: string;
      count: number;
      enforced: number;
      passed: number;
      semanticScores: number[];
      stylisticScores: number[];
      scopeScores: number[];
      combinedScores: number[];
      modes: Record<string, number>;
      earliest: number;
      latest: number;
    };

    const groups = new Map<string, VersionGroup>();

    for (const e of evals) {
      const key = `${e.provider}::${e.model}::${e.promptVersion}`;

      let group = groups.get(key);
      if (!group) {
        group = {
          provider: e.provider,
          model: e.model,
          promptVersion: e.promptVersion,
          count: 0,
          enforced: 0,
          passed: 0,
          semanticScores: [],
          stylisticScores: [],
          scopeScores: [],
          combinedScores: [],
          modes: {},
          earliest: e.createdAt,
          latest: e.createdAt,
        };
        groups.set(key, group);
      }

      group.count++;
      if (e.enforced) group.enforced++;
      if (e.passed) group.passed++;
      group.semanticScores.push(e.semanticScore);
      group.stylisticScores.push(e.stylisticScore);
      group.scopeScores.push(e.scopeScore);
      group.combinedScores.push(e.combinedScore);
      group.modes[e.editorialMode] = (group.modes[e.editorialMode] ?? 0) + 1;
      if (e.createdAt < group.earliest) group.earliest = e.createdAt;
      if (e.createdAt > group.latest) group.latest = e.createdAt;
    }

    return [...groups.values()]
      .map((g) => {
        const sort = (arr: number[]) => [...arr].sort((a, b) => a - b);
        const semSorted = sort(g.semanticScores);
        const stySorted = sort(g.stylisticScores);
        const scpSorted = sort(g.scopeScores);
        const cmbSorted = sort(g.combinedScores);

        return {
          provider: g.provider,
          model: g.model,
          promptVersion: g.promptVersion,
          count: g.count,
          enforced: g.enforced,
          passRate: g.enforced > 0 ? g.passed / g.enforced : 1,
          modes: g.modes,
          earliest: g.earliest,
          latest: g.latest,
          scores: {
            semantic: {
              mean: mean(g.semanticScores),
              p25: percentile(semSorted, 25),
              p50: percentile(semSorted, 50),
              p75: percentile(semSorted, 75),
            },
            stylistic: {
              mean: mean(g.stylisticScores),
              p25: percentile(stySorted, 25),
              p50: percentile(stySorted, 50),
              p75: percentile(stySorted, 75),
            },
            scope: {
              mean: mean(g.scopeScores),
              p25: percentile(scpSorted, 25),
              p50: percentile(scpSorted, 50),
              p75: percentile(scpSorted, 75),
            },
            combined: {
              mean: mean(g.combinedScores),
              p25: percentile(cmbSorted, 25),
              p50: percentile(cmbSorted, 50),
              p75: percentile(cmbSorted, 75),
            },
          },
        };
      })
      .sort((a, b) => b.latest - a.latest);
  },
});

// ── Correction Effectiveness ─────────────────────────────────────────────────

export const getCorrectionEffectiveness = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);

    const evals = await ctx.db.query("voiceEvaluations").collect();
    const corrected = evals.filter((e) => e.correctionAttempted);

    type TypeStats = {
      count: number;
      improved: number;
      notImproved: number;
      improvementDeltas: number[];
      initialScores: number[];
      finalScores: number[];
    };

    const initStats = (): TypeStats => ({
      count: 0,
      improved: 0,
      notImproved: 0,
      improvementDeltas: [],
      initialScores: [],
      finalScores: [],
    });

    const byType: Record<string, TypeStats> = {
      constraint_boost: initStats(),
      minimal_edit: initStats(),
      passthrough: initStats(),
    };

    const overall = initStats();

    for (const e of corrected) {
      const type = e.correctionType ?? "passthrough";
      const stats = byType[type] ?? initStats();
      const finalScore = e.finalCombinedScore ?? e.combinedScore;

      stats.count++;
      overall.count++;
      stats.initialScores.push(e.combinedScore);
      stats.finalScores.push(finalScore);
      overall.initialScores.push(e.combinedScore);
      overall.finalScores.push(finalScore);

      if (e.correctionImprovedScore) {
        stats.improved++;
        overall.improved++;
        stats.improvementDeltas.push(finalScore - e.combinedScore);
        overall.improvementDeltas.push(finalScore - e.combinedScore);
      } else {
        stats.notImproved++;
        overall.notImproved++;
      }

      byType[type] = stats;
    }

    const summarize = (s: TypeStats) => ({
      count: s.count,
      improved: s.improved,
      notImproved: s.notImproved,
      improvementRate: s.count > 0 ? s.improved / s.count : 0,
      avgImprovement:
        s.improvementDeltas.length > 0 ? mean(s.improvementDeltas) : 0,
      maxImprovement:
        s.improvementDeltas.length > 0 ? Math.max(...s.improvementDeltas) : 0,
      avgInitialScore: mean(s.initialScores),
      avgFinalScore: mean(s.finalScores),
      improvementDeltas: s.improvementDeltas,
    });

    const allImprovementDeltas = corrected
      .filter(
        (e) =>
          e.correctionImprovedScore && e.finalCombinedScore !== undefined
      )
      .map((e) => e.finalCombinedScore! - e.combinedScore);

    const improvementPercentiles =
      allImprovementDeltas.length > 0
        ? (() => {
            const sorted = [...allImprovementDeltas].sort((a, b) => a - b);
            return {
              p10: percentile(sorted, 10),
              p25: percentile(sorted, 25),
              p50: percentile(sorted, 50),
              p75: percentile(sorted, 75),
              p90: percentile(sorted, 90),
              min: sorted[0] ?? 0,
              max: sorted[sorted.length - 1] ?? 0,
              mean: mean(allImprovementDeltas),
            };
          })()
        : null;

    return {
      totalEvaluations: evals.length,
      totalCorrected: corrected.length,
      correctionRate: evals.length > 0 ? corrected.length / evals.length : 0,
      overall: summarize(overall),
      byType: {
        constraint_boost: summarize(byType.constraint_boost),
        minimal_edit: summarize(byType.minimal_edit),
        passthrough: summarize(byType.passthrough),
      },
      improvementPercentiles,
    };
  },
});

// ── Evaluation with failure labels ───────────────────────────────────────────

export const listEvaluationsWithFailureLabels = query({
  args: {
    limit: v.optional(v.number()),
    modeFilter: v.optional(
      v.union(
        v.literal("developmental"),
        v.literal("line"),
        v.literal("copy")
      )
    ),
    passedFilter: v.optional(v.boolean()),
  },
  handler: async (ctx, { limit, modeFilter, passedFilter }) => {
    await requireUser(ctx);

    const results = await ctx.db
      .query("voiceEvaluations")
      .withIndex("by_created", (q) => q.gte("createdAt", 0))
      .order("desc")
      .take(200);

    let filtered = results;
    if (modeFilter !== undefined) {
      filtered = filtered.filter((e) => e.editorialMode === modeFilter);
    }
    if (passedFilter !== undefined) {
      filtered = filtered.filter((e) => e.passed === passedFilter);
    }

    return filtered.slice(0, limit ?? 100).map((e) => {
      const failedDimensions: string[] = [];

      if (e.semanticScore < e.thresholds.semantic) {
        failedDimensions.push("semantic");
      }
      if (e.stylisticScore < e.thresholds.stylistic) {
        failedDimensions.push("stylistic");
      }
      if (e.scopeScore < e.thresholds.scope) {
        failedDimensions.push("scope");
      }
      if (
        failedDimensions.length === 0 &&
        e.combinedScore < e.thresholds.combined
      ) {
        failedDimensions.push("combined");
      }

      const headroom = {
        semantic: e.semanticScore - e.thresholds.semantic,
        stylistic: e.stylisticScore - e.thresholds.stylistic,
        scope: e.scopeScore - e.thresholds.scope,
        combined: e.combinedScore - e.thresholds.combined,
      };

      return {
        ...e,
        failedDimensions,
        headroom,
      };
    });
  },
});
