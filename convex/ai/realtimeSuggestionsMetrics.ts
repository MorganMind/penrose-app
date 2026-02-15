/**
 * Internal mutation for recording realtime suggestion telemetry.
 * Kept in a separate file (no "use node") so it can run in the V8 isolate.
 */

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const recordSuggestionMetric = internalMutation({
  args: {
    orgId: v.optional(v.id("orgs")),
    postId: v.optional(v.id("posts")),
    userId: v.id("users"),
    mode: v.string(),
    provider: v.string(),
    model: v.string(),
    promptVersion: v.string(),
    profileConfidence: v.optional(v.number()),
    aggressivenessLevel: v.string(),
    wasGenerated: v.boolean(),
    wasSuppressed: v.boolean(),
    suppressionReason: v.optional(v.string()),
    semanticScore: v.optional(v.number()),
    stylisticScore: v.optional(v.number()),
    scopeScore: v.optional(v.number()),
    combinedScore: v.optional(v.number()),
    enforcementClass: v.optional(v.string()),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("realtimeSuggestionMetrics", {
      ...args,
      createdAt: Date.now(),
    });
  },
});
