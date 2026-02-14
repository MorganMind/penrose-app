/**
 * Internal explainability layer (Phase 14.5 Part 4).
 *
 * For every refinement run, logs which metrics most influenced
 * the final score. Minimal internal inspection tooling to query
 * by run id.
 */

import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./access";
import { computeMetricInfluences } from "./lib/voiceExplainability";
import type { VoiceFingerprint, EditorialMode } from "./lib/voiceTypes";

// ── Record explainability (called from multiCandidate) ──────────────────────

export const recordRunExplainability = internalMutation({
  args: {
    runId: v.id("editorialRuns"),
    userId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
    originalFingerprint: v.any(),
    suggestionFingerprint: v.any(),
    profileFingerprint: v.optional(v.any()),
    semanticScore: v.number(),
    enforcementClass: v.string(),
    editorialMode: v.union(
      v.literal("developmental"),
      v.literal("line"),
      v.literal("copy")
    ),
  },
  handler: async (ctx, args) => {
    const original = args.originalFingerprint as VoiceFingerprint;
    const suggestion = args.suggestionFingerprint as VoiceFingerprint;
    const profile =
      (args.profileFingerprint as VoiceFingerprint) ?? original;

    const result = computeMetricInfluences(
      original,
      suggestion,
      profile,
      args.semanticScore,
      args.enforcementClass,
      args.editorialMode as EditorialMode
    );

    const now = Date.now();
    await ctx.db.insert("voiceRunExplainability", {
      runId: args.runId,
      userId: args.userId,
      orgId: args.orgId,
      cadenceDelta: result.cadenceDelta,
      punctuationDelta: result.punctuationDelta,
      lexicalDensityDelta: result.lexicalDensityDelta,
      semanticDelta: result.semanticDelta,
      constraintViolations: result.constraintViolations,
      topNegativeInfluences: result.topNegativeInfluences,
      topPositiveInfluences: result.topPositiveInfluences,
      createdAt: now,
    });
  },
});

// ── Query by run id (internal inspection) ───────────────────────────────────

export const getByRunId = query({
  args: { runId: v.id("editorialRuns") },
  handler: async (ctx, { runId }) => {
    await requireUser(ctx);
    return await ctx.db
      .query("voiceRunExplainability")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .first();
  },
});
