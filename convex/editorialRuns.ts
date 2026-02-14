import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// ── Validators ───────────────────────────────────────────────────────────

const editorialModeV = v.union(
  v.literal("developmental"),
  v.literal("line")
);

const enforcementClassV = v.union(
  v.literal("pass"),
  v.literal("soft_warning"),
  v.literal("failure"),
  v.literal("drift")
);

const enforcementOutcomeV = v.union(
  v.literal("pass"),
  v.literal("soft_warning_resolved"),
  v.literal("failure_resolved"),
  v.literal("drift_resolved"),
  v.literal("original_returned")
);

const generationPhaseV = v.union(
  v.literal("initial"),
  v.literal("enforcement_retry")
);

// ── Queries ──────────────────────────────────────────────────────────────

export const getActiveRun = internalQuery({
  args: {
    postId: v.optional(v.id("posts")),
    editorialMode: editorialModeV,
  },
  handler: async (ctx, { postId, editorialMode }) => {
    if (!postId) return null;
    return await ctx.db
      .query("editorialRuns")
      .withIndex("by_post_mode_status", (q) =>
        q
          .eq("postId", postId)
          .eq("editorialMode", editorialMode)
          .eq("status", "active")
      )
      .first();
  },
});

export const getRun = internalQuery({
  args: { runId: v.id("editorialRuns") },
  handler: async (ctx, { runId }) => ctx.db.get(runId),
});

export const getCandidates = internalQuery({
  args: { runId: v.id("editorialRuns") },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query("editorialCandidates")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect();
  },
});

export const getCandidate = internalQuery({
  args: {
    runId: v.id("editorialRuns"),
    candidateIndex: v.number(),
  },
  handler: async (ctx, { runId, candidateIndex }) => {
    return await ctx.db
      .query("editorialCandidates")
      .withIndex("by_run_and_index", (q) =>
        q.eq("runId", runId).eq("candidateIndex", candidateIndex)
      )
      .first();
  },
});

export const getCandidatesByPhase = internalQuery({
  args: {
    runId: v.id("editorialRuns"),
    phase: generationPhaseV,
  },
  handler: async (ctx, { runId, phase }) => {
    return await ctx.db
      .query("editorialCandidates")
      .withIndex("by_run_and_phase", (q) =>
        q.eq("runId", runId).eq("generationPhase", phase)
      )
      .collect();
  },
});

// ── Mutations ────────────────────────────────────────────────────────────

export const supersedePriorRuns = internalMutation({
  args: {
    postId: v.optional(v.id("posts")),
    editorialMode: editorialModeV,
  },
  handler: async (ctx, { postId, editorialMode }) => {
    if (!postId) return;
    const active = await ctx.db
      .query("editorialRuns")
      .withIndex("by_post_mode_status", (q) =>
        q
          .eq("postId", postId)
          .eq("editorialMode", editorialMode)
          .eq("status", "active")
      )
      .collect();

    for (const run of active) {
      await ctx.db.patch(run._id, { status: "superseded" });
    }
  },
});

export const createRun = internalMutation({
  args: {
    userId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
    postId: v.optional(v.id("posts")),
    editorialMode: editorialModeV,
    originalText: v.string(),
    variationSeed: v.number(),
    candidateCount: v.number(),
    selectedCandidateIndex: v.number(),
    bestPassingIndex: v.optional(v.number()),
    allCandidatesPassed: v.boolean(),
    fallbackUsed: v.boolean(),
    enforcementClass: enforcementClassV,
    enforcementOutcome: enforcementOutcomeV,
    retryAttempted: v.boolean(),
    returnedOriginal: v.boolean(),
    initialBestCombinedScore: v.optional(v.number()),
    initialBestSemanticScore: v.optional(v.number()),
    finalBestCombinedScore: v.optional(v.number()),
    finalBestSemanticScore: v.optional(v.number()),
    provider: v.string(),
    model: v.string(),
    promptVersion: v.string(),
    nudgeDirection: v.optional(v.string()),
    scratchpadSnapshot: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("editorialRuns", {
      ...args,
      status: "active",
      createdAt: Date.now(),
    });
  },
});

export const addCandidate = internalMutation({
  args: {
    runId: v.id("editorialRuns"),
    candidateIndex: v.number(),
    variationKey: v.string(),
    suggestedText: v.string(),
    evaluationId: v.optional(v.id("voiceEvaluations")),
    semanticScore: v.number(),
    stylisticScore: v.number(),
    scopeScore: v.number(),
    combinedScore: v.number(),
    selectionScore: v.number(),
    passed: v.boolean(),
    selected: v.boolean(),
    shown: v.boolean(),
    isFallback: v.boolean(),
    generationPhase: generationPhaseV,
    enforcementClass: v.optional(enforcementClassV),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("editorialCandidates", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const swapCandidate = internalMutation({
  args: {
    runId: v.id("editorialRuns"),
    candidateId: v.id("editorialCandidates"),
    candidateIndex: v.number(),
  },
  handler: async (ctx, { runId, candidateId, candidateIndex }) => {
    await ctx.db.patch(candidateId, { shown: true });
    await ctx.db.patch(runId, {
      selectedCandidateIndex: candidateIndex,
    });
  },
});
