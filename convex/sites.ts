import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgMember } from "./access";

/**
 * Resolve a site by its subdomain for the public site resolution hierarchy.
 *
 * Returns minimal metadata only — no posts, themes, or UI configuration.
 * This query is intentionally unauthenticated because the subdomain→siteId
 * mapping is needed before any auth context exists on public routes.
 *
 * Returns null if no site with that subdomain exists.
 */
export const getSiteBySubdomain = query({
  args: { subdomain: v.string() },
  handler: async (ctx, { subdomain }) => {
    // Validate subdomain format (defense in depth - middleware also validates)
    // RFC 1123: alphanumeric + hyphens, 1-63 chars, not starting/ending with hyphen
    // Reject multi-level subdomains (must be single segment)
    if (
      !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain) ||
      subdomain.includes(".")
    ) {
      return null;
    }

    const site = await ctx.db
      .query("sites")
      .withIndex("by_subdomain", (q) => q.eq("subdomain", subdomain))
      .unique();

    if (!site) return null;

    // Return only the fields needed for resolution — intentionally minimal.
    return {
      _id: site._id,
      name: site.name,
      subdomain: site.subdomain,
      orgId: site.orgId, // tenantId equivalent in this schema
    };
  },
});

/**
 * Return the (first) site for an organization.
 *
 * Authenticated — caller must be a member of the org.
 * Returns null if the org has no site yet.
 *
 * Today each org has exactly one auto-created site (see orgs.create).
 * When multi-site support lands this will need a list variant + picker.
 */
export const getSiteForOrg = query({
  args: {
    orgId: v.id("orgs"),
  },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId);

    const site = await ctx.db
      .query("sites")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();

    if (!site) return null;

    return {
      _id: site._id,
      name: site.name,
      subdomain: site.subdomain,
      orgId: site.orgId,
    };
  },
});

/**
 * Create a default site for an org that doesn't have one yet.
 *
 * Used as a backfill for orgs created before auto-site-creation existed,
 * or for orgs that somehow ended up without a site.
 *
 * Caller must be an org member. Subdomain will match the org slug.
 */
export const createDefaultSiteForOrg = mutation({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId);

    const existingSite = await ctx.db
      .query("sites")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();

    if (existingSite) {
      throw new Error("This organization already has a site");
    }

    const org = await ctx.db.get(orgId);
    if (!org) {
      throw new Error("Organization not found");
    }

    const existingSiteWithSubdomain = await ctx.db
      .query("sites")
      .withIndex("by_subdomain", (q) => q.eq("subdomain", org.slug))
      .unique();

    if (existingSiteWithSubdomain) {
      throw new Error(`Subdomain "${org.slug}" is already taken`);
    }

    const now = Date.now();
    const siteId = await ctx.db.insert("sites", {
      orgId,
      name: `${org.name}'s Site`,
      subdomain: org.slug,
      createdAt: now,
    });

    return siteId;
  },
});
