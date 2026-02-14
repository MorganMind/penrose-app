import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgMember } from "./access";

/**
 * Store a voice reaction signal.
 */
export const submitReaction = mutation({
  args: {
    orgId: v.id("orgs"),
    postId: v.optional(v.id("posts")),
    editorialMode: v.union(
      v.literal("developmental"),
      v.literal("line"),
      v.literal("copy")
    ),
    panelType: v.union(
      v.literal("quality"),
      v.literal("style"),
      v.literal("voice")
    ),
    reaction: v.string(),
    provider: v.string(),
    model: v.string(),
    promptVersion: v.string(),
    nudgeDirection: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireOrgMember(ctx, args.orgId);

    return await ctx.db.insert("voiceReactions", {
      ...args,
      userId,
      createdAt: Date.now(),
    });
  },
});

/**
 * Store a nudge request signal.
 */
export const recordNudge = mutation({
  args: {
    orgId: v.id("orgs"),
    postId: v.optional(v.id("posts")),
    editorialMode: v.union(
      v.literal("developmental"),
      v.literal("line"),
      v.literal("copy")
    ),
    nudgeDirection: v.string(),
    provider: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireOrgMember(ctx, args.orgId);

    return await ctx.db.insert("voiceNudges", {
      ...args,
      userId,
      createdAt: Date.now(),
    });
  },
});

/**
 * Total reaction count for a tenant (drives cadence logic).
 */
export const getReactionCount = query({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId);

    const reactions = await ctx.db
      .query("voiceReactions")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    return reactions.length;
  },
});
