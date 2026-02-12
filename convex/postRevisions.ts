import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgMember } from "./access";

/**
 * Restore a previous revision as the active working copy.
 *
 * Creates a NEW revision whose body is copied from the target revision.
 * The original revision is never modified — the timeline only moves forward.
 * Updates the post's body and activeRevisionId to the new revision.
 *
 * Only allowed on draft or scheduled posts. Published posts must be
 * returned to draft first.
 */
export const restoreRevision = mutation({
  args: {
    postId: v.id("posts"),
    revisionId: v.id("postRevisions"),
  },
  handler: async (ctx, { postId, revisionId }) => {
    const post = await ctx.db.get(postId);
    if (!post) throw new Error("Post not found");

    const { userId } = await requireOrgMember(ctx, post.orgId);

    if (post.status !== "draft" && post.status !== "scheduled") {
      throw new Error(
        "Revision restore is only allowed on draft or scheduled posts"
      );
    }

    const revision = await ctx.db.get(revisionId);
    if (!revision || revision.postId !== postId) {
      throw new Error("Revision not found for this post");
    }

    if (revision._id === post.activeRevisionId) {
      throw new Error("This revision is already active");
    }

    const now = Date.now();

    const latestRevision = await ctx.db
      .query("postRevisions")
      .withIndex("by_post_and_revision", (q) => q.eq("postId", postId))
      .order("desc")
      .first();

    const revisionNumber = (latestRevision?.revisionNumber ?? 0) + 1;

    const newRevisionId = await ctx.db.insert("postRevisions", {
      postId,
      body: revision.body,
      source: "restore",
      revisionNumber,
      createdAt: now,
      authorId: userId,
    });

    await ctx.db.patch(postId, {
      body: revision.body,
      activeRevisionId: newRevisionId,
      lastEditedAt: now,
      updatedAt: now,
    });

    return { revisionNumber };
  },
});

/**
 * List every revision for a post, newest first.
 *
 * Authenticated — caller must be a member of the post's org.
 * Returns metadata and a body preview (not the full body) to keep
 * payloads reasonable for long revision histories.
 */
export const listRevisionsForPost = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post) return [];

    await requireOrgMember(ctx, post.orgId);

    const revisions = await ctx.db
      .query("postRevisions")
      .withIndex("by_post_and_revision", (q) => q.eq("postId", postId))
      .order("desc")
      .collect();

    return revisions.map((r) => ({
      _id: r._id,
      revisionNumber: r.revisionNumber,
      source: r.source,
      aiMetadata: r.aiMetadata,
      createdAt: r.createdAt,
      bodyPreview: r.body.slice(0, 120),
    }));
  },
});
