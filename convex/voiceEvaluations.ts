import {
  query,
  internalMutation,
} from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./access";

// ── Internal mutation (called from voice engine action) ──────────────────────

export const recordEvaluation = internalMutation({
  args: {
    userId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
    postId: v.optional(v.id("posts")),
    editorialMode: v.union(
      v.literal("developmental"),
      v.literal("line"),
      v.literal("copy")
    ),
    originalFingerprint: v.any(),
    suggestionFingerprint: v.any(),
    profileFingerprint: v.optional(v.any()),
    profileStatus: v.union(
      v.literal("none"),
      v.literal("building"),
      v.literal("active")
    ),
    profileConfidence: v.optional(v.number()),
    profileConfidenceBand: v.optional(
      v.union(
        v.literal("low"),
        v.literal("medium"),
        v.literal("high")
      )
    ),
    semanticScore: v.number(),
    stylisticScore: v.number(),
    scopeScore: v.number(),
    combinedScore: v.number(),
    thresholds: v.object({
      semantic: v.number(),
      stylistic: v.number(),
      scope: v.number(),
      combined: v.number(),
    }),
    passed: v.boolean(),
    enforced: v.boolean(),
    correctionAttempted: v.boolean(),
    correctionType: v.optional(
      v.union(
        v.literal("constraint_boost"),
        v.literal("minimal_edit"),
        v.literal("passthrough")
      )
    ),
    correctionImprovedScore: v.optional(v.boolean()),
    finalCombinedScore: v.optional(v.number()),
    provider: v.string(),
    model: v.string(),
    promptVersion: v.string(),
    originalPreview: v.string(),
    suggestionPreview: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("voiceEvaluations", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const updateCorrection = internalMutation({
  args: {
    evaluationId: v.id("voiceEvaluations"),
    correctionType: v.union(
      v.literal("constraint_boost"),
      v.literal("minimal_edit"),
      v.literal("passthrough")
    ),
    correctionImprovedScore: v.optional(v.boolean()),
    finalCombinedScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.evaluationId, {
      correctionAttempted: true,
      correctionType: args.correctionType,
      correctionImprovedScore: args.correctionImprovedScore,
      finalCombinedScore: args.finalCombinedScore,
    });
  },
});

// ── Queries for dashboard / debugging ────────────────────────────────────────

export const listRecent = query({
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
  handler: async (ctx, { limit = 50, modeFilter, passedFilter }) => {
    await requireUser(ctx);

    const results = await ctx.db
      .query("voiceEvaluations")
      .withIndex("by_created", (q) => q.gte("createdAt", 0))
      .order("desc")
      .take(limit);

    let filtered = results;
    if (modeFilter !== undefined) {
      filtered = filtered.filter((e) => e.editorialMode === modeFilter);
    }
    if (passedFilter !== undefined) {
      filtered = filtered.filter((e) => e.passed === passedFilter);
    }

    return filtered;
  },
});

export const getByPost = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    await requireUser(ctx);

    return await ctx.db
      .query("voiceEvaluations")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .order("desc")
      .collect();
  },
});

export const getById = query({
  args: { evaluationId: v.id("voiceEvaluations") },
  handler: async (ctx, { evaluationId }) => {
    await requireUser(ctx);

    return await ctx.db.get(evaluationId);
  },
});

export const getStats = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);

    const all = await ctx.db.query("voiceEvaluations").collect();
    const total = all.length;
    const passed = all.filter((e) => e.passed).length;
    const enforced = all.filter((e) => e.enforced).length;
    const corrected = all.filter((e) => e.correctionAttempted).length;

    const byMode = {
      developmental: {
        total: 0,
        passed: 0,
        avgCombined: 0,
        scores: [] as number[],
      },
      line: { total: 0, passed: 0, avgCombined: 0, scores: [] as number[] },
      copy: { total: 0, passed: 0, avgCombined: 0, scores: [] as number[] },
    };

    for (const e of all) {
      const m = byMode[e.editorialMode as keyof typeof byMode];
      if (m) {
        m.total++;
        if (e.passed) m.passed++;
        m.scores.push(e.combinedScore);
      }
    }

    for (const mode of Object.values(byMode)) {
      mode.avgCombined =
        mode.scores.length > 0
          ? mode.scores.reduce((a, b) => a + b, 0) / mode.scores.length
          : 0;
    }

    return { total, passed, enforced, corrected, byMode };
  },
});
