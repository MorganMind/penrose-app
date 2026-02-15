/**
 * Voice regression — queries and mutations.
 *
 * Separate from voiceRegression.ts (actions) because "use node" files
 * can only export actions.
 */

import { query, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./access";

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

export const getBaselineInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("voiceRegressionBaseline")
      .order("desc")
      .first();
  },
});

// ── Mutations ──────────────────────────────────────────────────────────────

export const setBaseline = internalMutation({
  args: {
    configHash: v.string(),
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
    return await ctx.db.insert("voiceRegressionBaseline", {
      configHash: args.configHash,
      createdAt: Date.now(),
      createdBy: args.createdBy,
      static: args.static,
      live: args.live,
    });
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
