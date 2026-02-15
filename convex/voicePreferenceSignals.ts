/**
 * Bounded preference signals from Apply/Reject/Hunk toggles.
 *
 * Does NOT mutate the voice profile. Stores small nudges that influence
 * generation and candidate selection slightly. Voice score = hard constraint.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgMember } from "./access";
import { extractPreferenceSignals } from "./lib/preferenceSignals";

const sourceValidator = v.union(
  v.literal("apply"),
  v.literal("reject"),
  v.literal("hunk_apply")
);

// ── Record signals (called from edit UI on Apply/Reject) ─────────────────────

export const recordPreferenceSignals = mutation({
  args: {
    orgId: v.id("orgs"),
    postId: v.optional(v.id("posts")),
    editorialMode: v.union(
      v.literal("developmental"),
      v.literal("line"),
      v.literal("copy")
    ),
    source: sourceValidator,
    originalText: v.string(),
    appliedText: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireOrgMember(ctx, args.orgId);

    const signals = extractPreferenceSignals(
      args.originalText,
      args.appliedText,
      args.source
    );

    const now = Date.now();
    for (const s of signals) {
      await ctx.db.insert("voicePreferenceSignals", {
        orgId: args.orgId,
        userId,
        editorialMode: args.editorialMode,
        source: args.source,
        postId: args.postId,
        dimension: s.dimension,
        value: s.value,
        magnitude: s.magnitude,
        createdAt: now,
      });
    }

    return { recorded: signals.length };
  },
});

// ── Queries ────────────────────────────────────────────────────────────────

export const getSignalsForOrg = query({
  args: {
    orgId: v.id("orgs"),
    editorialMode: v.optional(
      v.union(
        v.literal("developmental"),
        v.literal("line"),
        v.literal("copy")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { orgId, editorialMode, limit = 100 }) => {
    await requireOrgMember(ctx, orgId);

    let q = ctx.db
      .query("voicePreferenceSignals")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc");

    const results = await q.take(limit ?? 100);

    const filtered = editorialMode
      ? results.filter((r) => r.editorialMode === editorialMode)
      : results;

    return filtered;
  },
});

export const getAggregatedPreferences = query({
  args: {
    orgId: v.id("orgs"),
    userId: v.optional(v.id("users")),
    editorialMode: v.optional(
      v.union(
        v.literal("developmental"),
        v.literal("line"),
        v.literal("copy")
      )
    ),
  },
  handler: async (ctx, { orgId, userId, editorialMode }) => {
    await requireOrgMember(ctx, orgId);

    let signals = await ctx.db
      .query("voicePreferenceSignals")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    if (userId) {
      signals = signals.filter((s) => s.userId === userId);
    }
    if (editorialMode) {
      signals = signals.filter((s) => s.editorialMode === editorialMode);
    }

    const { aggregateSignals } = await import("./lib/preferenceSignals");
    return aggregateSignals(
      signals.map((s) => ({
        dimension: s.dimension,
        value: s.value,
        magnitude: s.magnitude,
        createdAt: s.createdAt,
      }))
    );
  },
});
