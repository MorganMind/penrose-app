import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireOrgMember } from "./access";

// ── Time constants for compaction ─────────────────────────────────────────────

const ONE_MINUTE = 60 * 1000;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;
const ONE_WEEK = 7 * ONE_DAY;
const ONE_MONTH = 30 * ONE_DAY;

/**
 * Map a revision's age to a compaction bucket.
 * Returns `null` for revisions that should always be kept (< 60 min old).
 * Returns a bucket key for older revisions — only one revision per bucket survives.
 */
function getCompactionBucket(ageMs: number): string | null {
  // Keep all checkpoints from the last 60 minutes
  if (ageMs < ONE_HOUR) return null;

  // 1–24 hours: keep 1 per hour
  if (ageMs < ONE_DAY) {
    const hourBucket = Math.floor(ageMs / ONE_HOUR);
    return `hour-${hourBucket}`;
  }

  // 1–30 days: keep 1 per day
  if (ageMs < ONE_MONTH) {
    const dayBucket = Math.floor(ageMs / ONE_DAY);
    return `day-${dayBucket}`;
  }

  // 30+ days: keep 1 per week
  const weekBucket = Math.floor(ageMs / ONE_WEEK);
  return `week-${weekBucket}`;
}

// ── Restore ───────────────────────────────────────────────────────────────────

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

    // Use the title from the target revision's snapshot if available,
    // otherwise fall back to the current post title.
    const restoredTitle = revision.titleSnapshot ?? post.title;

    const newRevisionId = await ctx.db.insert("postRevisions", {
      postId,
      body: revision.body,
      titleSnapshot: restoredTitle,
      source: "restore",
      isPinned: false,
      revisionNumber,
      createdAt: now,
      authorId: userId,
    });

    await ctx.db.patch(postId, {
      title: restoredTitle,
      body: revision.body,
      activeRevisionId: newRevisionId,
      lastEditedAt: now,
      updatedAt: now,
    });

    console.log(
      `[checkpoint] restored rev ${revisionNumber} from rev ${revision.revisionNumber} for post ${postId}`
    );

    // Schedule compaction in the background
    await ctx.scheduler.runAfter(
      0,
      internal.postRevisions.compactRevisions,
      { postId }
    );

    return { revisionNumber };
  },
});

// ── Milestone management ──────────────────────────────────────────────────────

/** Hard cap on pinned milestones per post. */
const MILESTONE_CAP = 40;

/**
 * Pin the current draft state as a named milestone.
 * Milestones are never deleted by compaction.
 */
export const createMilestone = mutation({
  args: {
    postId: v.id("posts"),
    name: v.optional(v.string()),
  },
  handler: async (ctx, { postId, name }) => {
    const post = await ctx.db.get(postId);
    if (!post) throw new Error("Post not found");

    const { userId } = await requireOrgMember(ctx, post.orgId);

    // Enforce milestone hard cap
    const allRevisions = await ctx.db
      .query("postRevisions")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .collect();
    const pinnedCount = allRevisions.filter((r) => r.isPinned).length;
    if (pinnedCount >= MILESTONE_CAP) {
      throw new Error(
        `Maximum of ${MILESTONE_CAP} milestones reached. Unpin an existing milestone first.`
      );
    }

    const now = Date.now();

    const latestRevision = await ctx.db
      .query("postRevisions")
      .withIndex("by_post_and_revision", (q) => q.eq("postId", postId))
      .order("desc")
      .first();

    const revisionNumber = (latestRevision?.revisionNumber ?? 0) + 1;

    const revisionId = await ctx.db.insert("postRevisions", {
      postId,
      body: post.body ?? "",
      titleSnapshot: post.title,
      source: "milestone",
      isPinned: true,
      name: name?.trim() || `Milestone ${pinnedCount + 1}`,
      revisionNumber,
      createdAt: now,
      authorId: userId,
    });

    await ctx.db.patch(postId, {
      activeRevisionId: revisionId,
      lastEditedAt: now,
      updatedAt: now,
    });

    console.log(
      `[milestone] pinned rev ${revisionNumber} "${name ?? ""}" for post ${postId}`
    );

    return { revisionId, revisionNumber };
  },
});

/**
 * Rename an existing milestone.
 */
export const renameMilestone = mutation({
  args: {
    revisionId: v.id("postRevisions"),
    name: v.string(),
  },
  handler: async (ctx, { revisionId, name }) => {
    const revision = await ctx.db.get(revisionId);
    if (!revision) throw new Error("Revision not found");

    const post = await ctx.db.get(revision.postId);
    if (!post) throw new Error("Post not found");

    await requireOrgMember(ctx, post.orgId);

    if (!revision.isPinned) {
      throw new Error("Only pinned milestones can be renamed");
    }

    await ctx.db.patch(revisionId, { name: name.trim() });
  },
});

/**
 * Unpin a milestone, making it eligible for compaction.
 */
export const unpinMilestone = mutation({
  args: {
    revisionId: v.id("postRevisions"),
  },
  handler: async (ctx, { revisionId }) => {
    const revision = await ctx.db.get(revisionId);
    if (!revision) throw new Error("Revision not found");

    const post = await ctx.db.get(revision.postId);
    if (!post) throw new Error("Post not found");

    await requireOrgMember(ctx, post.orgId);

    if (!revision.isPinned) {
      throw new Error("This revision is not pinned");
    }

    await ctx.db.patch(revisionId, { isPinned: false });

    console.log(
      `[milestone] unpinned rev ${revision.revisionNumber} for post ${revision.postId}`
    );
  },
});

/**
 * Pin an existing (non-pinned) revision as a milestone.
 */
export const pinRevision = mutation({
  args: {
    revisionId: v.id("postRevisions"),
    name: v.optional(v.string()),
  },
  handler: async (ctx, { revisionId, name }) => {
    const revision = await ctx.db.get(revisionId);
    if (!revision) throw new Error("Revision not found");

    const post = await ctx.db.get(revision.postId);
    if (!post) throw new Error("Post not found");

    await requireOrgMember(ctx, post.orgId);

    if (revision.isPinned) {
      throw new Error("This revision is already pinned");
    }

    // Enforce cap
    const allRevisions = await ctx.db
      .query("postRevisions")
      .withIndex("by_post", (q) => q.eq("postId", revision.postId))
      .collect();
    const pinnedCount = allRevisions.filter((r) => r.isPinned).length;
    if (pinnedCount >= MILESTONE_CAP) {
      throw new Error(
        `Maximum of ${MILESTONE_CAP} milestones reached. Unpin an existing milestone first.`
      );
    }

    await ctx.db.patch(revisionId, {
      isPinned: true,
      source: "milestone",
      name: name?.trim() || `Milestone`,
    });

    console.log(
      `[milestone] pinned existing rev ${revision.revisionNumber} for post ${revision.postId}`
    );
  },
});

// ── Time-based compaction ─────────────────────────────────────────────────────

/**
 * Background compaction: reduce revision count using tiered time buckets.
 *
 * Retention policy:
 *   - Keep ALL checkpoints from the last 60 minutes
 *   - Keep 1 per hour for 1–24 hours
 *   - Keep 1 per day for 1–30 days
 *   - Keep 1 per week for 30+ days
 *
 * Never deletes:
 *   - Pinned milestones (isPinned === true)
 *   - The initial revision (source === "initial")
 *   - The post's active revision (activeRevisionId)
 *   - Publish checkpoints (source === "publish")
 */
export const compactRevisions = internalMutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post) return;

    const now = Date.now();

    const revisions = await ctx.db
      .query("postRevisions")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .collect();

    // Sort oldest first for deterministic bucket assignment
    revisions.sort((a, b) => a.createdAt - b.createdAt);

    // Track which revision to keep per bucket (latest wins)
    const bucketKeepers = new Map<string, typeof revisions[0]>();
    const toDelete: typeof revisions = [];

    for (const rev of revisions) {
      // Never delete protected revisions
      if (rev.isPinned) continue;
      if (rev.source === "initial") continue;
      if (rev.source === "publish") continue;
      if (rev._id === post.activeRevisionId) continue;

      const ageMs = now - rev.createdAt;
      const bucket = getCompactionBucket(ageMs);

      // null bucket = keep (within 60-minute window)
      if (bucket === null) continue;

      const existing = bucketKeepers.get(bucket);
      if (!existing) {
        // First revision in this bucket — tentatively keep it
        bucketKeepers.set(bucket, rev);
      } else {
        // Keep the later revision, mark the earlier for deletion
        if (rev.createdAt > existing.createdAt) {
          toDelete.push(existing);
          bucketKeepers.set(bucket, rev);
        } else {
          toDelete.push(rev);
        }
      }
    }

    // Delete compacted revisions
    for (const rev of toDelete) {
      await ctx.db.delete(rev._id);
    }

    if (toDelete.length > 0) {
      console.log(
        `[compaction] removed ${toDelete.length} revision(s) for post ${postId}, ` +
          `${revisions.length - toDelete.length} remaining`
      );
    }
  },
});

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * List revisions for a post, with milestones first then chronological.
 *
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

    // Split into milestones and regular checkpoints
    const milestones = revisions.filter((r) => r.isPinned);
    const checkpoints = revisions.filter((r) => !r.isPinned);

    // Milestones first (newest first), then checkpoints (newest first)
    const ordered = [...milestones, ...checkpoints];

    return ordered.map((r) => ({
      _id: r._id,
      revisionNumber: r.revisionNumber,
      source: r.source,
      aiMetadata: r.aiMetadata,
      titleSnapshot: r.titleSnapshot,
      isPinned: r.isPinned ?? false,
      name: r.name,
      createdAt: r.createdAt,
      bodyPreview: r.body.slice(0, 120),
    }));
  },
});
