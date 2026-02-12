import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Look up an organization by its URL slug.
 * Returns the full org document or null if not found.
 *
 * This query is intentionally unauthenticated — org metadata (name, slug)
 * is not sensitive. Tenant-scoped DATA queries (posts, sites, members)
 * must use the access helpers in access.ts.
 */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    return await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
  },
});

/**
 * Create a new organization with the current user as owner.
 *
 * Also provisions a default site whose subdomain matches the org slug,
 * so the authoring loop is functional immediately after onboarding
 * without a separate "create site" step.
 *
 * Atomicity: org, membership, and site are created in a single Convex
 * mutation — if any insert fails the whole transaction rolls back.
 */
export const create = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, { name, slug }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthenticated");
    }

    // ── Uniqueness checks ──────────────────────────────────────────────────
    const existingOrg = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (existingOrg) {
      throw new Error("Slug already taken");
    }

    const existingSite = await ctx.db
      .query("sites")
      .withIndex("by_subdomain", (q) => q.eq("subdomain", slug))
      .unique();
    if (existingSite) {
      throw new Error("Subdomain already taken");
    }

    // ── Create org + owner membership ──────────────────────────────────────
    const now = Date.now();

    const orgId = await ctx.db.insert("orgs", {
      name,
      slug,
      createdAt: now,
    });

    await ctx.db.insert("orgMembers", {
      orgId,
      userId,
      role: "owner",
      createdAt: now,
    });

    // ── Provision default site ─────────────────────────────────────────────
    await ctx.db.insert("sites", {
      orgId,
      name: `${name}'s Site`,
      subdomain: slug,
      createdAt: now,
    });

    return orgId;
  },
});
