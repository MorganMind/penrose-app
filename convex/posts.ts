import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireOrgMember } from "./access";
import { slugify } from "./lib/slugify";

// ── Types ────────────────────────────────────────────────────────────────────

export type PublicPost = {
  _id: Id<"posts">;
  title: string;
  slug: string;
  body: string | null;
  createdAt: number;
};

// ── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new post as a draft.
 *
 * Generates a URL-safe slug from the title with per-site uniqueness.
 * Creates the initial revision (revision 1) and sets it as the active
 * revision pointer.
 */
export const createPost = mutation({
  args: {
    orgId: v.id("orgs"),
    siteId: v.id("sites"),
    title: v.string(),
    body: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, siteId, title, body }) => {
    const { userId } = await requireOrgMember(ctx, orgId);

    const site = await ctx.db.get(siteId);
    if (!site || site.orgId !== orgId) {
      throw new Error(
        "Site not found or does not belong to this organization"
      );
    }

    const baseSlug = slugify(title) || "untitled";
    let slug = baseSlug;
    let suffix = 0;

    while (true) {
      const existing = await ctx.db
        .query("posts")
        .withIndex("by_site_and_slug", (q) =>
          q.eq("siteId", siteId).eq("slug", slug)
        )
        .unique();

      if (!existing) break;

      suffix++;
      if (suffix > 99) {
        throw new Error(
          "Unable to generate a unique slug — too many collisions"
        );
      }
      slug = `${baseSlug}-${suffix}`;
    }

    const now = Date.now();
    const bodyText = body ?? "";

    const postId = await ctx.db.insert("posts", {
      orgId,
      siteId,
      title,
      slug,
      body: bodyText,
      status: "draft",
      authorId: userId,
      lastEditedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const revisionId = await ctx.db.insert("postRevisions", {
      postId,
      body: bodyText,
      source: "initial",
      revisionNumber: 1,
      createdAt: now,
      authorId: userId,
    });

    await ctx.db.patch(postId, { activeRevisionId: revisionId });

    return postId;
  },
});

/**
 * Save edits to a post's title and body.
 *
 * Every save creates a new revision for full reversibility.
 * When `aiSource` is provided, the revision is marked as AI-originated
 * so the audit trail distinguishes human from machine edits.
 */
export const updatePost = mutation({
  args: {
    postId: v.id("posts"),
    title: v.string(),
    body: v.string(),
    aiSource: v.optional(
      v.object({
        operationType: v.string(),
        provider: v.string(),
        model: v.string(),
      })
    ),
  },
  handler: async (ctx, { postId, title, body, aiSource }) => {
    const post = await ctx.db.get(postId);
    if (!post) throw new Error("Post not found");

    const { userId } = await requireOrgMember(ctx, post.orgId);

    const now = Date.now();

    const latestRevision = await ctx.db
      .query("postRevisions")
      .withIndex("by_post_and_revision", (q) => q.eq("postId", postId))
      .order("desc")
      .first();

    const revisionNumber = (latestRevision?.revisionNumber ?? 0) + 1;

    const revisionId = await ctx.db.insert("postRevisions", {
      postId,
      body,
      source: aiSource ? "ai" : "manual",
      aiMetadata: aiSource
        ? {
            provider: aiSource.provider,
            model: aiSource.model,
            operationType: aiSource.operationType,
          }
        : undefined,
      revisionNumber,
      createdAt: now,
      authorId: userId,
    });

    await ctx.db.patch(postId, {
      title,
      body,
      activeRevisionId: revisionId,
      lastEditedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Flip a draft post to published.
 * Only drafts can be published via this mutation.
 */
export const publishPost = mutation({
  args: {
    postId: v.id("posts"),
  },
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post) throw new Error("Post not found");

    await requireOrgMember(ctx, post.orgId);

    if (post.status !== "draft") {
      throw new Error(
        `Cannot publish a post with status "${post.status}" — only drafts can be published`
      );
    }

    await ctx.db.patch(postId, {
      status: "published",
      updatedAt: Date.now(),
    });
  },
});

/**
 * Return a published post to draft status.
 *
 * This is the required gateway before running editorial passes on
 * previously published content. The post becomes invisible on public
 * routes immediately.
 */
export const unpublishPost = mutation({
  args: {
    postId: v.id("posts"),
  },
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post) throw new Error("Post not found");

    await requireOrgMember(ctx, post.orgId);

    if (post.status !== "published") {
      throw new Error(
        `Only published posts can be returned to draft. Current status: "${post.status}"`
      );
    }

    await ctx.db.patch(postId, {
      status: "draft",
      updatedAt: Date.now(),
    });
  },
});

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch a single post for the edit page.
 * Authenticated — caller must be a member of the post's org.
 */
export const getPost = query({
  args: {
    postId: v.id("posts"),
  },
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post) return null;

    await requireOrgMember(ctx, post.orgId);

    return {
      _id: post._id,
      orgId: post.orgId,
      siteId: post.siteId,
      title: post.title,
      slug: post.slug,
      body: post.body ?? null,
      status: post.status,
      activeRevisionId: post.activeRevisionId ?? null,
      lastEditedAt: post.lastEditedAt ?? post.createdAt,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };
  },
});

/**
 * Dashboard listing: posts for a site with optional status filter.
 * Authenticated — caller must be a member of the owning org.
 */
export const listPostsForSite = query({
  args: {
    siteId: v.id("sites"),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("scheduled"),
        v.literal("published"),
        v.literal("archived")
      )
    ),
  },
  handler: async (ctx, { siteId, status }) => {
    const site = await ctx.db.get(siteId);
    if (!site) return [];

    await requireOrgMember(ctx, site.orgId);

    const posts = await ctx.db
      .query("posts")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();

    const filtered = status ? posts.filter((p) => p.status === status) : posts;

    return filtered.map((post) => ({
      _id: post._id,
      title: post.title,
      slug: post.slug,
      status: post.status,
      createdAt: post.createdAt,
    }));
  },
});

/**
 * Public query: resolve a single published post by slug.
 * Unauthenticated — published content is public by definition.
 * Returns null for non-existent or non-published posts.
 */
export const getPostBySlug = query({
  args: {
    siteId: v.id("sites"),
    slug: v.string(),
  },
  handler: async (ctx, { siteId, slug }): Promise<PublicPost | null> => {
    const post = await ctx.db
      .query("posts")
      .withIndex("by_site_and_slug", (q) =>
        q.eq("siteId", siteId).eq("slug", slug)
      )
      .unique();

    if (!post) return null;
    if (post.status !== "published") return null;

    return {
      _id: post._id,
      title: post.title,
      slug: post.slug,
      body: post.body ?? null,
      createdAt: post.createdAt,
    };
  },
});
