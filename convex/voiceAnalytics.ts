import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./access";

// ── Multi-candidate run analytics ────────────────────────────────────────

export const listRuns = query({
  args: {
    limit: v.optional(v.number()),
    modeFilter: v.optional(
      v.union(v.literal("developmental"), v.literal("line"))
    ),
  },
  handler: async (ctx, { limit, modeFilter }) => {
    await requireUser(ctx);

    let results = await ctx.db
      .query("editorialRuns")
      .withIndex("by_created")
      .order("desc")
      .take(limit ?? 50);

    if (modeFilter) {
      results = results.filter((r) => r.editorialMode === modeFilter);
    }

    return results.map((r) => ({
      _id: r._id,
      editorialMode: r.editorialMode,
      variationSeed: r.variationSeed,
      candidateCount: r.candidateCount,
      selectedCandidateIndex: r.selectedCandidateIndex,
      allCandidatesPassed: r.allCandidatesPassed,
      fallbackUsed: r.fallbackUsed,
      status: r.status,
      provider: r.provider,
      model: r.model,
      nudgeDirection: r.nudgeDirection,
      createdAt: r.createdAt,
    }));
  },
});

export const getRunWithCandidates = query({
  args: { runId: v.id("editorialRuns") },
  handler: async (ctx, { runId }) => {
    await requireUser(ctx);

    const run = await ctx.db.get(runId);
    if (!run) return null;

    const candidates = await ctx.db
      .query("editorialCandidates")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect();

    const sorted = candidates.sort(
      (a, b) => b.selectionScore - a.selectionScore
    );

    return {
      run: {
        _id: run._id,
        editorialMode: run.editorialMode,
        variationSeed: run.variationSeed,
        candidateCount: run.candidateCount,
        selectedCandidateIndex: run.selectedCandidateIndex,
        bestPassingIndex: run.bestPassingIndex,
        allCandidatesPassed: run.allCandidatesPassed,
        fallbackUsed: run.fallbackUsed,
        enforcementClass: run.enforcementClass,
        enforcementOutcome: run.enforcementOutcome,
        retryAttempted: run.retryAttempted,
        returnedOriginal: run.returnedOriginal,
        initialBestCombinedScore: run.initialBestCombinedScore,
        finalBestCombinedScore: run.finalBestCombinedScore,
        status: run.status,
        provider: run.provider,
        model: run.model,
        promptVersion: run.promptVersion,
        nudgeDirection: run.nudgeDirection,
        createdAt: run.createdAt,
        originalPreview: run.originalText.slice(0, 300),
      },
      candidates: sorted.map((c) => ({
        _id: c._id,
        candidateIndex: c.candidateIndex,
        variationKey: c.variationKey,
        semanticScore: c.semanticScore,
        stylisticScore: c.stylisticScore,
        scopeScore: c.scopeScore,
        combinedScore: c.combinedScore,
        selectionScore: c.selectionScore,
        passed: c.passed,
        selected: c.selected,
        shown: c.shown,
        isFallback: c.isFallback,
        generationPhase: c.generationPhase,
        enforcementClass: c.enforcementClass,
        evaluationId: c.evaluationId,
        suggestionPreview: c.suggestedText.slice(0, 300),
      })),
    };
  },
});

export const getMultiCandidateStats = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);

    const runs = await ctx.db.query("editorialRuns").collect();
    const candidates = await ctx.db.query("editorialCandidates").collect();

    const total = runs.length;
    const withFallback = runs.filter((r) => r.fallbackUsed).length;
    const allPassed = runs.filter((r) => r.allCandidatesPassed).length;
    const superseded = runs.filter((r) => r.status === "superseded").length;

    // How often was the first candidate (index 0) selected vs second (index 1)?
    const selectedDistribution: Record<number, number> = {};
    for (const r of runs) {
      selectedDistribution[r.selectedCandidateIndex] =
        (selectedDistribution[r.selectedCandidateIndex] ?? 0) + 1;
    }

    // How much do the two primary candidates typically differ?
    const runPairs = new Map<string, typeof candidates>();
    for (const c of candidates) {
      if (c.isFallback) continue;
      const arr = runPairs.get(c.runId) ?? [];
      arr.push(c);
      runPairs.set(c.runId, arr);
    }

    const selectionDeltas: number[] = [];
    const combinedDeltas: number[] = [];

    for (const [, pair] of runPairs) {
      if (pair.length < 2) continue;
      const sorted = pair.sort(
        (a, b) => b.selectionScore - a.selectionScore
      );
      selectionDeltas.push(
        Math.abs(sorted[0].selectionScore - sorted[1].selectionScore)
      );
      combinedDeltas.push(
        Math.abs(sorted[0].combinedScore - sorted[1].combinedScore)
      );
    }

    const avgSelectionDelta =
      selectionDeltas.length > 0
        ? selectionDeltas.reduce((a, b) => a + b, 0) /
          selectionDeltas.length
        : 0;
    const avgCombinedDelta =
      combinedDeltas.length > 0
        ? combinedDeltas.reduce((a, b) => a + b, 0) /
          combinedDeltas.length
        : 0;

    // By variation key: which variations produce the best scores?
    const byVariation: Record<
      string,
      { count: number; wins: number; avgSelection: number; scores: number[] }
    > = {};

    for (const c of candidates) {
      if (c.isFallback) continue;
      const v = byVariation[c.variationKey] ?? {
        count: 0,
        wins: 0,
        avgSelection: 0,
        scores: [],
      };
      v.count++;
      if (c.selected) v.wins++;
      v.scores.push(c.selectionScore);
      byVariation[c.variationKey] = v;
    }

    for (const v of Object.values(byVariation)) {
      v.avgSelection =
        v.scores.length > 0
          ? v.scores.reduce((a, b) => a + b, 0) / v.scores.length
          : 0;
    }

    return {
      totalRuns: total,
      fallbackRate: total > 0 ? withFallback / total : 0,
      allPassedRate: total > 0 ? allPassed / total : 0,
      supersededCount: superseded,
      selectedDistribution,
      avgSelectionDelta,
      avgCombinedDelta,
      byVariation,
    };
  },
});

// ── Enforcement analytics ────────────────────────────────────────────────

export const getEnforcementStats = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);

    const runs = await ctx.db.query("editorialRuns").collect();

    // Only include runs with enforcement data (post-enforcement schema)
    const runsWithEnforcement = runs.filter(
      (r) =>
        r.enforcementClass != null &&
        r.enforcementOutcome != null &&
        r.retryAttempted != null &&
        r.returnedOriginal != null
    );

    const total = runsWithEnforcement.length;
    if (total === 0) {
      return {
        total: 0,
        byClass: {},
        byOutcome: {},
        retryRate: 0,
        originalReturnRate: 0,
        retrySuccessRate: 0,
        scoreImprovement: null,
        byMode: {},
      };
    }

    // ── By enforcement class ──────────────────────────────────
    const byClass: Record<string, { count: number; pct: number }> = {};

    for (const r of runsWithEnforcement) {
      const cls = r.enforcementClass!;
      if (!byClass[cls]) byClass[cls] = { count: 0, pct: 0 };
      byClass[cls].count++;
    }
    for (const v of Object.values(byClass)) {
      v.pct = v.count / total;
    }

    // ── By outcome ────────────────────────────────────────────
    const byOutcome: Record<string, { count: number; pct: number }> = {};

    for (const r of runsWithEnforcement) {
      const out = r.enforcementOutcome!;
      if (!byOutcome[out]) byOutcome[out] = { count: 0, pct: 0 };
      byOutcome[out].count++;
    }
    for (const v of Object.values(byOutcome)) {
      v.pct = v.count / total;
    }

    // ── Retry metrics ─────────────────────────────────────────
    const retried = runsWithEnforcement.filter((r) => r.retryAttempted);
    const retryRate = retried.length / total;

    const originalReturned = runsWithEnforcement.filter(
      (r) => r.returnedOriginal
    );
    const originalReturnRate = originalReturned.length / total;

    // Retry success: retried AND did NOT return original
    const retrySuccesses = retried.filter((r) => !r.returnedOriginal);
    const retrySuccessRate =
      retried.length > 0 ? retrySuccesses.length / retried.length : 0;

    // ── Score improvement from retry ──────────────────────────
    const improvements: number[] = [];
    for (const r of retried) {
      if (
        r.initialBestCombinedScore !== undefined &&
        r.finalBestCombinedScore !== undefined
      ) {
        improvements.push(
          r.finalBestCombinedScore - r.initialBestCombinedScore
        );
      }
    }

    const scoreImprovement =
      improvements.length > 0
        ? {
            count: improvements.length,
            avg:
              improvements.reduce((a, b) => a + b, 0) /
              improvements.length,
            min: Math.min(...improvements),
            max: Math.max(...improvements),
            positiveCount: improvements.filter((d) => d > 0).length,
          }
        : null;

    // ── By mode ───────────────────────────────────────────────
    const byMode: Record<
      string,
      {
        total: number;
        passCount: number;
        softWarningCount: number;
        failureCount: number;
        driftCount: number;
        retryCount: number;
        originalReturnCount: number;
        passRate: number;
        retrySuccessRate: number;
      }
    > = {};

    for (const mode of ["developmental", "line"]) {
      const modeRuns = runsWithEnforcement.filter(
        (r) => r.editorialMode === mode
      );
      const modeTotal = modeRuns.length;
      if (modeTotal === 0) continue;

      const modeRetried = modeRuns.filter((r) => r.retryAttempted);
      const modeOrigReturned = modeRuns.filter((r) => r.returnedOriginal);
      const modeRetrySuccess = modeRetried.filter(
        (r) => !r.returnedOriginal
      );

      byMode[mode] = {
        total: modeTotal,
        passCount: modeRuns.filter(
          (r) => r.enforcementClass === "pass"
        ).length,
        softWarningCount: modeRuns.filter(
          (r) => r.enforcementClass === "soft_warning"
        ).length,
        failureCount: modeRuns.filter(
          (r) => r.enforcementClass === "failure"
        ).length,
        driftCount: modeRuns.filter(
          (r) => r.enforcementClass === "drift"
        ).length,
        retryCount: modeRetried.length,
        originalReturnCount: modeOrigReturned.length,
        passRate:
          modeRuns.filter((r) => r.enforcementClass === "pass").length /
          modeTotal,
        retrySuccessRate:
          modeRetried.length > 0
            ? modeRetrySuccess.length / modeRetried.length
            : 0,
      };
    }

    return {
      total,
      byClass,
      byOutcome,
      retryRate,
      originalReturnRate,
      retrySuccessRate,
      scoreImprovement,
      byMode,
    };
  },
});

// ── Confidence analytics ─────────────────────────────────────────────

export const getConfidenceOverview = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);

    const profiles = await ctx.db.query("voiceProfiles").collect();

    const bandCounts = { low: 0, medium: 0, high: 0 };
    const confidenceValues: number[] = [];

    for (const p of profiles) {
      const band = p.confidenceBand ?? "low";
      bandCounts[band as keyof typeof bandCounts]++;
      confidenceValues.push(p.confidence ?? 0);
    }

    // Per-profile detail
    const profileDetails = profiles.map((p) => ({
      _id: p._id,
      userId: p.userId,
      orgId: p.orgId,
      status: p.status,
      confidence: p.confidence ?? 0,
      confidenceBand: (p.confidenceBand ?? "low") as "low" | "medium" | "high",
      components: p.confidenceComponents ?? {
        wordConfidence: 0,
        sampleConfidence: 0,
        diversityScore: 0,
        temporalSpread: 0,
      },
      sampleCount: p.sampleCount,
      totalWordCount: p.totalWordCount,
      uniqueSourceTypes: p.uniqueSourceTypes ?? 0,
      uniquePostIds: p.uniquePostIds ?? 0,
      sourceTypeCounts: p.sourceTypeCounts ?? {
        published_post: 0,
        manual_revision: 0,
        initial_draft: 0,
        baseline_sample: 0,
      },
      averageSampleWordCount: p.averageSampleWordCount ?? 0,
      lastSampleAt: p.lastSampleAt,
      createdAt: p.createdAt,
    }));

    // Confidence impact on evaluations
    const evals = await ctx.db.query("voiceEvaluations").collect();

    type BandMetrics = {
      count: number;
      avgCombined: number;
      avgSemantic: number;
      avgStylistic: number;
      passRate: number;
    };

    const evalsByBand: Record<string, BandMetrics> = {};

    for (const band of ["low", "medium", "high"]) {
      const bandEvals = evals.filter(
        (e) => e.profileConfidenceBand === band
      );
      if (bandEvals.length === 0) continue;

      const passCount = bandEvals.filter((e) => e.passed).length;
      evalsByBand[band] = {
        count: bandEvals.length,
        avgCombined:
          bandEvals.reduce((a, e) => a + e.combinedScore, 0) /
          bandEvals.length,
        avgSemantic:
          bandEvals.reduce((a, e) => a + e.semanticScore, 0) /
          bandEvals.length,
        avgStylistic:
          bandEvals.reduce((a, e) => a + e.stylisticScore, 0) /
          bandEvals.length,
        passRate: passCount / bandEvals.length,
      };
    }

    // Without confidence (profile not active)
    const noBandEvals = evals.filter(
      (e) => !e.profileConfidenceBand
    );
    if (noBandEvals.length > 0) {
      evalsByBand["none"] = {
        count: noBandEvals.length,
        avgCombined:
          noBandEvals.reduce((a, e) => a + e.combinedScore, 0) /
          noBandEvals.length,
        avgSemantic:
          noBandEvals.reduce((a, e) => a + e.semanticScore, 0) /
          noBandEvals.length,
        avgStylistic:
          noBandEvals.reduce((a, e) => a + e.stylisticScore, 0) /
          noBandEvals.length,
        passRate:
          noBandEvals.filter((e) => e.passed).length /
          noBandEvals.length,
      };
    }

    return {
      totalProfiles: profiles.length,
      bandCounts,
      confidenceValues,
      profileDetails,
      evalsByBand,
    };
  },
});

export const getEnforcementTimeline = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireUser(ctx);

    const runs = await ctx.db
      .query("editorialRuns")
      .withIndex("by_created")
      .order("desc")
      .take(limit ?? 100);

    return runs.map((r) => ({
      _id: r._id,
      editorialMode: r.editorialMode,
      enforcementClass: r.enforcementClass,
      enforcementOutcome: r.enforcementOutcome,
      retryAttempted: r.retryAttempted,
      returnedOriginal: r.returnedOriginal,
      initialBestCombinedScore: r.initialBestCombinedScore,
      initialBestSemanticScore: r.initialBestSemanticScore,
      finalBestCombinedScore: r.finalBestCombinedScore,
      finalBestSemanticScore: r.finalBestSemanticScore,
      candidateCount: r.candidateCount,
      model: r.model,
      createdAt: r.createdAt,
    }));
  },
});
