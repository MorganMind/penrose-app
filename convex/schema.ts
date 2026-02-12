import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  orgs: defineTable({
    name: v.string(),
    slug: v.string(),
    createdAt: v.number(),
  }).index("by_slug", ["slug"]),

  orgMembers: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    role: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("editor"),
      v.literal("author"),
      v.literal("viewer")
    ),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"])
    .index("by_org_and_user", ["orgId", "userId"]),

  sites: defineTable({
    orgId: v.id("orgs"),
    name: v.string(),
    subdomain: v.string(),
    customDomain: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_subdomain", ["subdomain"])
    .index("by_custom_domain", ["customDomain"]),

  posts: defineTable({
    orgId: v.id("orgs"),
    siteId: v.id("sites"),
    title: v.string(),
    slug: v.string(),
    body: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("scheduled"),
      v.literal("published"),
      v.literal("archived")
    ),
    authorId: v.id("users"),
    activeRevisionId: v.optional(v.id("postRevisions")),
    lastEditedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_site", ["siteId"])
    .index("by_site_and_slug", ["siteId", "slug"]),

  postRevisions: defineTable({
    postId: v.id("posts"),
    body: v.string(),
    source: v.union(
      v.literal("initial"),
      v.literal("manual"),
      v.literal("ai"),
      v.literal("restore")
    ),
    aiMetadata: v.optional(
      v.object({
        provider: v.string(),
        model: v.string(),
        operationType: v.string(),
        prompt: v.optional(v.string()),
      })
    ),
    revisionNumber: v.number(),
    createdAt: v.number(),
    authorId: v.id("users"),
  })
    .index("by_post", ["postId"])
    .index("by_post_and_revision", ["postId", "revisionNumber"]),
});
