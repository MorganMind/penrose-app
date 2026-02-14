/**
 * Cross-run drift detection (Phase 14.5 Part 3).
 *
 * Rolling metrics per user: average voice similarity over last N
 * refinements, average semantic preservation, score variance.
 * Monitors for downward trends or variance spikes.
 * Model id and prompt version stored with every run for regression tracing.
 */

import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireUser } from "./access";

const ROLLING_WINDOW = 20;
const DRIFT_THRESHOLD = 0.08;
const VARIANCE_SPIKE_MULTIPLIER = 2.5;
const MIN_RUNS_FOR_DRIFT = 5;

// ── Record run metrics (called from multiCandidate) ────────────────────────

export const recordRunMetrics = internalMutation({
  args: {
    runId: v.id("editorialRuns"),
    userId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
    editorialMode: v.union(
      v.literal("developmental"),
      v.literal("line"),
      v.literal("copy")
    ),
    provider: v.string(),
    model: v.string(),
    promptVersion: v.string(),
    semanticScore: v.number(),
    stylisticScore: v.number(),
    combinedScore: v.number(),
    profileConfidence: v.optional(v.number()),
    enforcementClass: v.optional(
      v.union(
        v.literal("pass"),
        v.literal("soft_warning"),
        v.literal("failure"),
        v.literal("drift")
      )
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("voiceRunMetrics", {
      runId: args.runId,
      userId: args.userId,
      orgId: args.orgId,
      editorialMode: args.editorialMode,
      provider: args.provider,
      model: args.model,
      promptVersion: args.promptVersion,
      semanticScore: args.semanticScore,
      stylisticScore: args.stylisticScore,
      combinedScore: args.combinedScore,
      profileConfidence: args.profileConfidence,
      enforcementClass: args.enforcementClass,
      createdAt: now,
    });
  },
});

// ── Drift detection (internal) ─────────────────────────────────────────────

export const getRollingMetrics = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { userId, limit = ROLLING_WINDOW }) => {
    const metrics = await ctx.db
      .query("voiceRunMetrics")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
    return metrics.reverse();
  },
});

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return (
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length
  );
}

export const checkDriftForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const metrics = await ctx.db
      .query("voiceRunMetrics")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(ROLLING_WINDOW);

    if (metrics.length < MIN_RUNS_FOR_DRIFT) return null;

    const recent = metrics.slice(0, Math.min(10, metrics.length));
    const older = metrics.slice(10, metrics.length);

    if (older.length < 3) return null;

    const recentStylistic = recent.map((m) => m.stylisticScore);
    const olderStylistic = older.map((m) => m.stylisticScore);
    const recentSemantic = recent.map((m) => m.semanticScore);
    const olderSemantic = older.map((m) => m.semanticScore);

    const avgRecentStylistic =
      recentStylistic.reduce((a, b) => a + b, 0) / recentStylistic.length;
    const avgOlderStylistic =
      olderStylistic.reduce((a, b) => a + b, 0) / olderStylistic.length;
    const varRecent = variance(recentStylistic);
    const varOlder = variance(olderStylistic);

    const stylisticDrop = avgOlderStylistic - avgRecentStylistic;
    const varianceSpike =
      varOlder > 0 && varRecent > varOlder * VARIANCE_SPIKE_MULTIPLIER;

    if (stylisticDrop > DRIFT_THRESHOLD) {
      return {
        alertType: "similarity_drop" as const,
        severity: stylisticDrop > 0.12 ? "high" : "medium",
        model: recent[0]?.model,
        promptVersion: recent[0]?.promptVersion,
        rollingAvgBefore: avgOlderStylistic,
        rollingAvgAfter: avgRecentStylistic,
        varianceBefore: varOlder,
        varianceAfter: varRecent,
        runCount: metrics.length,
      };
    }

    if (varianceSpike) {
      return {
        alertType: "variance_spike" as const,
        severity: "medium",
        model: recent[0]?.model,
        promptVersion: recent[0]?.promptVersion,
        rollingAvgBefore: avgOlderStylistic,
        rollingAvgAfter: avgRecentStylistic,
        varianceBefore: varOlder,
        varianceAfter: varRecent,
        runCount: metrics.length,
      };
    }

    return null;
  },
});

export const runDriftCheck = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const drift = await ctx.runQuery(
      internal.voiceRunMetrics.checkDriftForUser,
      { userId }
    );
    if (!drift) return;

    await ctx.runMutation(internal.voiceRunMetrics.createDriftAlert, {
      userId,
      model: drift.model ?? "unknown",
      promptVersion: drift.promptVersion ?? "unknown",
      alertType: drift.alertType,
      severity: drift.severity as "low" | "medium" | "high",
      rollingAvgBefore: drift.rollingAvgBefore,
      rollingAvgAfter: drift.rollingAvgAfter,
      varianceBefore: drift.varianceBefore,
      varianceAfter: drift.varianceAfter,
      runCount: drift.runCount,
    });
  },
});

export const createDriftAlert = internalMutation({
  args: {
    userId: v.id("users"),
    model: v.string(),
    promptVersion: v.string(),
    previousModel: v.optional(v.string()),
    previousPromptVersion: v.optional(v.string()),
    alertType: v.union(
      v.literal("similarity_drop"),
      v.literal("variance_spike"),
      v.literal("downward_trend")
    ),
    severity: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high")
    ),
    rollingAvgBefore: v.optional(v.number()),
    rollingAvgAfter: v.optional(v.number()),
    varianceBefore: v.optional(v.number()),
    varianceAfter: v.optional(v.number()),
    runCount: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("voiceDriftAlerts", {
      ...args,
      acknowledged: false,
      createdAt: Date.now(),
    });
  },
});

// ── Deployment freeze (revert config) ───────────────────────────────────────

export const getDeploymentConfig = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const row = await ctx.db
      .query("voiceDeploymentConfig")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    return row?.value ?? null;
  },
});

export const setDeploymentFrozen = internalMutation({
  args: {
    frozen: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { frozen, reason }) => {
    const existing = await ctx.db
      .query("voiceDeploymentConfig")
      .withIndex("by_key", (q) => q.eq("key", "deployment_frozen"))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        value: frozen ? "true" : "false",
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("voiceDeploymentConfig", {
        key: "deployment_frozen",
        value: frozen ? "true" : "false",
        updatedAt: now,
      });
    }
    if (reason !== undefined) {
      const reasonRow = await ctx.db
        .query("voiceDeploymentConfig")
        .withIndex("by_key", (q) => q.eq("key", "freeze_reason"))
        .first();
      if (reasonRow) {
        await ctx.db.patch(reasonRow._id, { value: reason, updatedAt: now });
      } else {
        await ctx.db.insert("voiceDeploymentConfig", {
          key: "freeze_reason",
          value: reason,
          updatedAt: now,
        });
      }
    }
  },
});

export const revertToPreviousConfig = internalMutation({
  args: {
    previousModel: v.string(),
    previousPromptVersion: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const upsert = async (key: string, value: string) => {
      const existing = await ctx.db
        .query("voiceDeploymentConfig")
        .withIndex("by_key", (q) => q.eq("key", key))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, { value, updatedAt: now });
      } else {
        await ctx.db.insert("voiceDeploymentConfig", {
          key,
          value,
          updatedAt: now,
        });
      }
    };
    await upsert("revert_model", args.previousModel);
    await upsert("revert_prompt_version", args.previousPromptVersion);
    await upsert("revert_reason", args.reason);
    await upsert("deployment_frozen", "true");
  },
});

// ── Internal inspection (query by run, rolling stats) ──────────────────────

export const getMetricsByRunId = query({
  args: { runId: v.id("editorialRuns") },
  handler: async (ctx, { runId }) => {
    await requireUser(ctx);
    return await ctx.db
      .query("voiceRunMetrics")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .first();
  },
});

export const getRollingStatsForUser = query({
  args: {
    userId: v.id("users"),
    windowSize: v.optional(v.number()),
  },
  handler: async (ctx, { userId, windowSize = ROLLING_WINDOW }) => {
    await requireUser(ctx);

    const metrics = await ctx.db
      .query("voiceRunMetrics")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(windowSize);

    if (metrics.length === 0) {
      return {
        runCount: 0,
        avgSemantic: 0,
        avgStylistic: 0,
        avgCombined: 0,
        varianceSemantic: 0,
        varianceStylistic: 0,
        varianceCombined: 0,
      };
    }

    const semantic = metrics.map((m) => m.semanticScore);
    const stylistic = metrics.map((m) => m.stylisticScore);
    const combined = metrics.map((m) => m.combinedScore);

    const avg = (arr: number[]) =>
      arr.reduce((a, b) => a + b, 0) / arr.length;

    return {
      runCount: metrics.length,
      avgSemantic: avg(semantic),
      avgStylistic: avg(stylistic),
      avgCombined: avg(combined),
      varianceSemantic: variance(semantic),
      varianceStylistic: variance(stylistic),
      varianceCombined: variance(combined),
      latestModel: metrics[0]?.model,
      latestPromptVersion: metrics[0]?.promptVersion,
    };
  },
});

export const listUnacknowledgedDriftAlerts = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 50 }) => {
    await requireUser(ctx);
    return await ctx.db
      .query("voiceDriftAlerts")
      .withIndex("by_acknowledged", (q) => q.eq("acknowledged", false))
      .order("desc")
      .take(limit ?? 50);
  },
});
