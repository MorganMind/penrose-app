# Phase 9: Drafts + Editorial Review Loop — Input Snapshot

## Inventory

- convex/schema.ts
- convex/posts.ts
- convex/access.ts
- convex/orgs.ts
- convex/sites.ts
- convex/users.ts
- convex/auth.ts
- convex/auth.config.ts
- convex/http.ts
- convex/lib/slugify.ts
- convex/testEnv.ts
- convex/README.md
- convex/_generated/api.d.ts
- convex/_generated/dataModel.d.ts
- convex/_generated/server.d.ts
- middleware.ts
- app/layout.tsx
- app/ConvexClientProvider.tsx
- app/(app)/layout.tsx
- app/(app)/app/page.tsx
- app/(app)/app/[orgSlug]/page.tsx
- app/(app)/app/[orgSlug]/posts/page.tsx
- app/(app)/app/[orgSlug]/posts/new/page.tsx
- app/(app)/app/onboarding/page.tsx
- app/(app)/settings/page.tsx
- app/(app)/components/UserMenu.tsx
- app/(public)/layout.tsx
- app/(public)/page.tsx
- app/(public)/p/[slug]/page.tsx
- app/signin/page.tsx
- lib/urls.ts
- lib/resolveSite.ts
- lib/useOrgBySlug.ts
- package.json
- next.config.ts
- tsconfig.json
- convex.json
- convex/tsconfig.json
- eslint.config.mjs
- scripts/generate-auth-keys.mjs

---

## convex/schema.ts

```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  // Organizations represent workspaces in the multi-tenant system.
  // Each org has a unique slug used for URL routing (e.g., /app/acme).
  orgs: defineTable({
    name: v.string(),
    slug: v.string(),
    createdAt: v.number(),
  }).index("by_slug", ["slug"]),

  // Organization members link users to orgs with specific roles.
  // Users can belong to multiple orgs with different roles.
  // CRITICAL: Every org-scoped query must validate membership before returning data.
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

  // Sites represent individual blogs/websites within an organization.
  // Each site has a unique subdomain and optional custom domain.
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

  // Posts are content items belonging to a site.
  // orgId is denormalized for efficient tenant-scoped queries.
  posts: defineTable({
    orgId: v.id("orgs"),
    siteId: v.id("sites"),
    title: v.string(),
    slug: v.string(),
    body: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("published"),
      v.literal("archived")
    ),
    authorId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_site", ["siteId"])
    .index("by_site_and_slug", ["siteId", "slug"]),
});
```

---

## convex/posts.ts

```ts
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireRole, requireOrgMember } from "./access";
import { slugify } from "./lib/slugify";

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 100000; // ~100KB

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Public-facing post data returned by getPostBySlug.
 * Intentionally minimal — only fields needed for public display.
 */
export type PublicPost = {
  _id: Id<"posts">;
  title: string;
  slug: string;
  body: string | null;
  createdAt: number;
};

// ── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new published post under a site.
 *
 * Security:
 *   1. Caller must be authenticated.
 *   2. Caller must have author role or higher in the org that owns the site.
 *   3. The site must actually belong to the supplied orgId.
 *
 * Slug generation:
 *   Derives a URL-safe slug from the title. If that slug already exists
 *   on the same site, appends -1, -2, … until a unique slug is found
 *   (capped at 99 attempts).
 */
export const createPost = mutation({
  args: {
    orgId: v.id("orgs"),
    siteId: v.id("sites"),
    title: v.string(),
    body: v.string(),
  },
  handler: async (ctx, { orgId, siteId, title, body }) => {
    // 1. Role-based permission check (authors and above can create posts)
    const { userId } = await requireRole(ctx, orgId, ["owner", "admin", "editor", "author"]);

    // 2. Input validation
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();

    if (!trimmedTitle) {
      throw new Error("Title cannot be empty");
    }
    if (trimmedTitle.length > MAX_TITLE_LENGTH) {
      throw new Error(`Title cannot exceed ${MAX_TITLE_LENGTH} characters`);
    }
    if (trimmedBody.length > MAX_BODY_LENGTH) {
      throw new Error(`Body cannot exceed ${MAX_BODY_LENGTH} characters`);
    }

    // 3. Verify site belongs to this org
    const site = await ctx.db.get(siteId);
    if (!site || site.orgId !== orgId) {
      throw new Error(
        "Site not found or does not belong to this organization"
      );
    }

    // 4. Slug generation with per-site uniqueness
    const baseSlug = slugify(trimmedTitle) || "untitled";
    let slug = baseSlug;
    let suffix = 0;

    // Check if base slug exists before entering loop
    const baseExists = await ctx.db
      .query("posts")
      .withIndex("by_site_and_slug", (q) =>
        q.eq("siteId", siteId).eq("slug", baseSlug)
      )
      .unique();

    if (baseExists) {
      // Only enter loop if collision exists
      while (suffix < 99) {
        suffix++;
        slug = `${baseSlug}-${suffix}`;

        const existing = await ctx.db
          .query("posts")
          .withIndex("by_site_and_slug", (q) =>
            q.eq("siteId", siteId).eq("slug", slug)
          )
          .unique();

        if (!existing) break;
      }

      if (suffix >= 99) {
        throw new Error(
          "Unable to generate a unique slug — too many collisions"
        );
      }
    }

    // 5. Insert the post
    const now = Date.now();
    return await ctx.db.insert("posts", {
      orgId,
      siteId,
      title: trimmedTitle,
      slug,
      body: trimmedBody,
      status: "published",
      authorId: userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * Dashboard listing: all posts for a site.
 *
 * Authenticated — the caller must be a member of the org that owns the
 * site. Returns posts ordered by creation date (newest first) with
 * status included for filtering in the UI.
 */
export const listPostsForSite = query({
  args: {
    siteId: v.id("sites"),
  },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!site) return [];

    // Membership gate via the site's owning org
    await requireOrgMember(ctx, site.orgId);

    const posts = await ctx.db
      .query("posts")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();

    // Sort by createdAt descending (newest first)
    posts.sort((a, b) => b.createdAt - a.createdAt);

    return posts.map((post) => ({
      _id: post._id,
      title: post.title,
      slug: post.slug,
      status: post.status,
      createdAt: post.createdAt,
    }));
  },
});

/**
 * Resolve a single published post by its slug within a specific site.
 *
 * The lookup uses the composite index (siteId, slug) so the same slug
 * under a different site will never resolve here. Only posts with
 * status "published" are returned — drafts and archived posts are
 * invisible on public routes.
 *
 * This query is intentionally unauthenticated: published post content
 * is public by definition.
 *
 * Returns null if no matching published post exists.
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

    // No post with that slug on this site
    if (!post) return null;

    // Only published posts are visible on public routes
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
```

---

## convex/access.ts

```ts
import { QueryCtx, MutationCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id, Doc } from "./_generated/dataModel";

/**
 * Role definitions for organization membership.
 * Ordered from highest to lowest privilege for reference.
 */
export const ROLES = ["owner", "admin", "editor", "author", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Ensure the request is from an authenticated user.
 * 
 * @throws Error if user is not authenticated
 * @returns The authenticated user's ID
 * 
 * Usage:
 *   const userId = await requireUser(ctx);
 */
export async function requireUser(
  ctx: QueryCtx | MutationCtx
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  
  if (!userId) {
    throw new Error("Unauthorized: Authentication required");
  }
  
  return userId;
}

/**
 * Verify the authenticated user is a member of the specified organization.
 * 
 * @throws Error if user is not authenticated
 * @throws Error if user is not a member of the organization
 * @returns Object containing userId and the membership document
 * 
 * Usage:
 *   const { userId, membership } = await requireOrgMember(ctx, orgId);
 */
export async function requireOrgMember(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"orgs">
): Promise<{ userId: Id<"users">; membership: Doc<"orgMembers"> }> {
  const userId = await requireUser(ctx);

  const membership = await ctx.db
    .query("orgMembers")
    .withIndex("by_org_and_user", (q) =>
      q.eq("orgId", orgId).eq("userId", userId)
    )
    .unique();

  if (!membership) {
    throw new Error(
      "Forbidden: You are not a member of this organization"
    );
  }

  return { userId, membership };
}

/**
 * Verify the authenticated user has one of the allowed roles in the organization.
 * 
 * @param ctx - Query or mutation context
 * @param orgId - The organization to check membership in
 * @param allowedRoles - Array of roles that are permitted for this operation
 * 
 * @throws Error if user is not authenticated
 * @throws Error if user is not a member of the organization
 * @throws Error if user's role is not in the allowedRoles array
 * @returns Object containing userId and the membership document
 * 
 * Usage:
 *   // Only owners and admins can delete
 *   const { userId, membership } = await requireRole(ctx, orgId, ["owner", "admin"]);
 *   
 *   // Authors and above can create posts
 *   const { userId } = await requireRole(ctx, orgId, ["owner", "admin", "editor", "author"]);
 */
export async function requireRole(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"orgs">,
  allowedRoles: Role[]
): Promise<{ userId: Id<"users">; membership: Doc<"orgMembers"> }> {
  const { userId, membership } = await requireOrgMember(ctx, orgId);

  if (!allowedRoles.includes(membership.role)) {
    throw new Error(
      `Forbidden: This action requires one of these roles: ${allowedRoles.join(", ")}. Your role: ${membership.role}`
    );
  }

  return { userId, membership };
}
```

---

## convex/orgs.ts

```ts
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
```

---

## convex/sites.ts

```ts
import { query } from "./_generated/server";
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
```

---

## convex/users.ts

```ts
import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Get the current authenticated user's ID and all organization memberships.
 * Returns null if not authenticated.
 * 
 * This is the canonical way to check "who am I" and "what orgs do I belong to"
 * from the client.
 */
export const whoami = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    
    if (!userId) {
      if (process.env.NODE_ENV === "development") {
        console.log("whoami: getAuthUserId returned null - token not validated");
      }
      return null;
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      console.log("whoami: User ID found in auth but not in database:", userId);
      return null;
    }

    const memberships = await ctx.db
      .query("orgMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const orgs = await Promise.all(
      memberships.map(async (membership) => {
        const org = await ctx.db.get(membership.orgId);
        return {
          orgId: membership.orgId,
          name: org?.name ?? null,
          slug: org?.slug ?? null,
          role: membership.role,
        };
      })
    );

    return {
      userId,
      name: user?.name,
      email: user?.email,
      image: user?.image,
      orgs,
    };
  },
});
```

---

## convex/auth.ts

```ts
/**
 * ⚠️ AUTH FILE - DO NOT MODIFY WITHOUT ASKING USER FIRST.
 * Auth is fragile. See .cursorrules and README.
 */
import { convexAuth } from "@convex-dev/auth/server";
import Google from "@auth/core/providers/google";

/**
 * Convex Auth configuration.
 * Pass provider reference - Convex Auth reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET automatically.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google],
  callbacks: {
    async redirect({ redirectTo }) {
      if (redirectTo?.startsWith("http")) return redirectTo;
      const nextJsUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      return redirectTo ? `${nextJsUrl}${redirectTo}` : `${nextJsUrl}/app`;
    },
  },
});
```

---

## convex/auth.config.ts

```ts
/**
 * ⚠️ AUTH FILE - DO NOT MODIFY WITHOUT ASKING USER FIRST.
 * Convex platform auth config - tells Convex which OIDC issuers to trust.
 * Required for Convex Auth. Domain is your Convex site URL.
 */
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL ?? "https://rapid-trout-661.convex.site",
      applicationID: "convex",
    },
  ],
};
```

---

## convex/http.ts

```ts
/**
 * ⚠️ AUTH FILE - DO NOT MODIFY WITHOUT ASKING USER FIRST.
 */
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Add all auth routes (OAuth callbacks, JWT verification, etc.)
auth.addHttpRoutes(http);

export default http;
```

---

## convex/lib/slugify.ts

```ts
/**
 * Turn a human title into a URL-safe slug.
 * 
 * Strips everything except lowercase alphanumerics and hyphens,
 * collapses runs of hyphens, trims leading/trailing hyphens,
 * and caps length at 100 characters.
 * 
 * @param text - The text to slugify
 * @returns A URL-safe slug string
 * 
 * @example
 *   slugify("Hello World!") // "hello-world"
 *   slugify("  Test---Post  ") // "test-post"
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}
```

---

## convex/testEnv.ts

```ts
import { action } from "./_generated/server";

/**
 * Temporary test action to verify environment variables are accessible in Convex
 */
export const checkEnvVars = action(async () => {
  const googleId = process.env.AUTH_GOOGLE_ID;
  const googleSecret = process.env.AUTH_GOOGLE_SECRET;
  
  return {
    hasGoogleId: !!googleId,
    hasGoogleSecret: !!googleSecret,
    googleIdLength: googleId?.length || 0,
    googleSecretLength: googleSecret?.length || 0,
    // Don't log the actual secrets, just confirm they exist
    allEnvVars: Object.keys(process.env).filter(key => 
      key.includes("GOOGLE") || key.includes("AUTH")
    ),
  };
});
```

---

## convex/README.md

```md
# Welcome to your Convex functions directory!

Write your Convex functions here.
See https://docs.convex.dev/functions for more.

A query function that takes two arguments looks like:

\`\`\`ts
// convex/myFunctions.ts
import { query } from "./_generated/server";
import { v } from "convex/values";

export const myQueryFunction = query({
  // Validators for arguments.
  args: {
    first: v.number(),
    second: v.string(),
  },

  // Function implementation.
  handler: async (ctx, args) => {
    // Read the database as many times as you need here.
    // See https://docs.convex.dev/database/reading-data.
    const documents = await ctx.db.query("tablename").collect();

    // Arguments passed from the client are properties of the args object.
    console.log(args.first, args.second);

    // Write arbitrary JavaScript here: filter, aggregate, build derived data,
    // remove non-public properties, or create new objects.
    return documents;
  },
});
\`\`\`

Using this query function in a React component looks like:

\`\`\`ts
const data = useQuery(api.myFunctions.myQueryFunction, {
  first: 10,
  second: "hello",
});
\`\`\`

A mutation function looks like:

\`\`\`ts
// convex/myFunctions.ts
import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const myMutationFunction = mutation({
  // Validators for arguments.
  args: {
    first: v.string(),
    second: v.string(),
  },

  // Function implementation.
  handler: async (ctx, args) => {
    // Insert or modify documents in the database here.
    // Mutations can also read from the database like queries.
    // See https://docs.convex.dev/database/writing-data.
    const message = { body: args.first, author: args.second };
    const id = await ctx.db.insert("messages", message);

    // Optionally, return a value from your mutation.
    return await ctx.db.get("messages", id);
  },
});
\`\`\`

Using this mutation function in a React component looks like:

\`\`\`ts
const mutation = useMutation(api.myFunctions.myMutationFunction);
function handleButtonPress() {
  // fire and forget, the most common way to use mutations
  mutation({ first: "Hello!", second: "me" });
  // OR
  // use the result once the mutation has completed
  mutation({ first: "Hello!", second: "me" }).then((result) =>
    console.log(result),
  );
}
\`\`\`

Use the Convex CLI to push your functions to a deployment. See everything
the Convex CLI can do by running \`npx convex -h\` in your project root
directory. To learn more, launch the docs with \`npx convex docs\`.
```

---

## convex/_generated/api.d.ts

```ts
/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as auth from "../auth.js";
import type * as http from "../http.js";
import type * as lib_slugify from "../lib/slugify.js";
import type * as orgs from "../orgs.js";
import type * as posts from "../posts.js";
import type * as sites from "../sites.js";
import type * as testEnv from "../testEnv.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  auth: typeof auth;
  http: typeof http;
  "lib/slugify": typeof lib_slugify;
  orgs: typeof orgs;
  posts: typeof posts;
  sites: typeof sites;
  testEnv: typeof testEnv;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
```

---

## convex/_generated/dataModel.d.ts

```ts
/* eslint-disable */
/**
 * Generated data model types.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  DataModelFromSchemaDefinition,
  DocumentByName,
  TableNamesInDataModel,
  SystemTableNames,
} from "convex/server";
import type { GenericId } from "convex/values";
import schema from "../schema.js";

/**
 * The names of all of your Convex tables.
 */
export type TableNames = TableNamesInDataModel<DataModel>;

/**
 * The type of a document stored in Convex.
 *
 * @typeParam TableName - A string literal type of the table name (like "users").
 */
export type Doc<TableName extends TableNames> = DocumentByName<
  DataModel,
  TableName
>;

/**
 * An identifier for a document in Convex.
 *
 * Convex documents are uniquely identified by their `Id`, which is accessible
 * on the `_id` field. To learn more, see [Document IDs](https://docs.convex.dev/using/document-ids).
 *
 * Documents can be loaded using `db.get(tableName, id)` in query and mutation functions.
 *
 * IDs are just strings at runtime, but this type can be used to distinguish them from other
 * strings when type checking.
 *
 * @typeParam TableName - A string literal type of the table name (like "users").
 */
export type Id<TableName extends TableNames | SystemTableNames> =
  GenericId<TableName>;

/**
 * A type describing your Convex data model.
 *
 * This type includes information about what tables you have, the type of
 * documents stored in those tables, and the indexes defined on them.
 *
 * This type is used to parameterize methods like `queryGeneric` and
 * `mutationGeneric` to make them type-safe.
 */
export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
```

---

## convex/_generated/server.d.ts

```ts
/* eslint-disable */
/**
 * Generated utilities for implementing server-side Convex query and mutation functions.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import {
  ActionBuilder,
  HttpActionBuilder,
  MutationBuilder,
  QueryBuilder,
  GenericActionCtx,
  GenericMutationCtx,
  GenericQueryCtx,
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";
import type { DataModel } from "./dataModel.js";

/**
 * Define a query in this Convex app's public API.
 *
 * This function will be allowed to read your Convex database and will be accessible from the client.
 *
 * @param func - The query function. It receives a {@link QueryCtx} as its first argument.
 * @returns The wrapped query. Include this as an `export` to name it and make it accessible.
 */
export declare const query: QueryBuilder<DataModel, "public">;

/**
 * Define a query that is only accessible from other Convex functions (but not from the client).
 *
 * This function will be allowed to read from your Convex database. It will not be accessible from the client.
 *
 * @param func - The query function. It receives a {@link QueryCtx} as its first argument.
 * @returns The wrapped query. Include this as an `export` to name it and make it accessible.
 */
export declare const internalQuery: QueryBuilder<DataModel, "internal">;

/**
 * Define a mutation in this Convex app's public API.
 *
 * This function will be allowed to modify your Convex database and will be accessible from the client.
 *
 * @param func - The mutation function. It receives a {@link MutationCtx} as its first argument.
 * @returns The wrapped mutation. Include this as an `export` to name it and make it accessible.
 */
export declare const mutation: MutationBuilder<DataModel, "public">;

/**
 * Define a mutation that is only accessible from other Convex functions (but not from the client).
 *
 * This function will be allowed to modify your Convex database. It will not be accessible from the client.
 *
 * @param func - The mutation function. It receives a {@link MutationCtx} as its first argument.
 * @returns The wrapped mutation. Include this as an `export` to name it and make it accessible.
 */
export declare const internalMutation: MutationBuilder<DataModel, "internal">;

/**
 * Define an action in this Convex app's public API.
 *
 * An action is a function which can execute any JavaScript code, including non-deterministic
 * code and code with side-effects, like calling third-party services.
 * They can be run in Convex's JavaScript environment or in Node.js using the "use node" directive.
 * They can interact with the database indirectly by calling queries and mutations using the {@link ActionCtx}.
 *
 * @param func - The action. It receives an {@link ActionCtx} as its first argument.
 * @returns The wrapped action. Include this as an `export` to name it and make it accessible.
 */
export declare const action: ActionBuilder<DataModel, "public">;

/**
 * Define an action that is only accessible from other Convex functions (but not from the client).
 *
 * @param func - The function. It receives an {@link ActionCtx} as its first argument.
 * @returns The wrapped function. Include this as an `export` to name it and make it accessible.
 */
export declare const internalAction: ActionBuilder<DataModel, "internal">;

/**
 * Define an HTTP action.
 *
 * The wrapped function will be used to respond to HTTP requests received
 * by a Convex deployment if the requests matches the path and method where
 * this action is routed. Be sure to route this httpAction in `convex/http.js`.
 *
 * @param func - The function. It receives an {@link ActionCtx} as its first argument
 * and a Fetch API `Request` object as its second.
 * @returns The wrapped function. Import this function from `convex/http.js` and route it to hook it up.
 */
export declare const httpAction: HttpActionBuilder;

/**
 * A set of services for use within Convex query functions.
 *
 * The query context is passed as the first argument to any Convex query
 * function run on the server.
 *
 * This differs from the {@link MutationCtx} because all of the services are
 * read-only.
 */
export type QueryCtx = GenericQueryCtx<DataModel>;

/**
 * A set of services for use within Convex mutation functions.
 *
 * The mutation context is passed as the first argument to any Convex mutation
 * function run on the server.
 */
export type MutationCtx = GenericMutationCtx<DataModel>;

/**
 * A set of services for use within Convex action functions.
 *
 * The action context is passed as the first argument to any Convex action
 * function run on the server.
 */
export type ActionCtx = GenericActionCtx<DataModel>;

/**
 * An interface to read from the database within Convex query functions.
 *
 * The two entry points are {@link DatabaseReader.get}, which fetches a single
 * document by its {@link Id}, or {@link DatabaseReader.query}, which starts
 * building a query.
 */
export type DatabaseReader = GenericDatabaseReader<DataModel>;

/**
 * An interface to read from and write to the database within Convex mutation
 * functions.
 *
 * Convex guarantees that all writes within a single mutation are
 * executed atomically, so you never have to worry about partial writes leaving
 * your data in an inconsistent state. See [the Convex Guide](https://docs.convex.dev/understanding/convex-fundamentals/functions#atomicity-and-optimistic-concurrency-control)
 * for the guarantees Convex provides your functions.
 */
export type DatabaseWriter = GenericDatabaseWriter<DataModel>;
```

---

## middleware.ts

```ts
/**
 * ⚠️ AUTH FILE - DO NOT MODIFY WITHOUT ASKING USER FIRST.
 */
import {
  convexAuthNextjsMiddleware,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

/** Domains that are always treated as the apex (no site context). */
const APEX_HOSTNAMES = new Set(["penrosepages.com", "www.penrosepages.com"]);

/**
 * Validate subdomain format (RFC 1123 compliant).
 * Allows alphanumeric + hyphens, 1-63 chars, not starting/ending with hyphen.
 * Rejects multi-level subdomains (e.g., "a.b" is invalid).
 */
function isValidSubdomain(subdomain: string): boolean {
  // RFC 1123: alphanumeric + hyphens, 1-63 chars, not starting/ending with hyphen
  // Also reject multi-level subdomains (must be single segment)
  return (
    /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain) &&
    !subdomain.includes(".")
  );
}

/**
 * Extract a public-facing subdomain from a Host header value, or return null
 * if the host is the apex domain, www, or a raw localhost address.
 *
 * Examples:
 *   "penrosepages.com"          → null   (apex)
 *   "www.penrosepages.com"      → null   (apex alias)
 *   "heather.penrosepages.com"  → "heather"
 *   "localhost:3000"            → null   (local dev)
 *   "heather.localhost:3000"    → "heather" (local dev with subdomain)
 */
function extractSubdomain(host: string): string | null {
  // Strip port, lower-case for reliable comparisons
  const hostname = host.split(":")[0].toLowerCase();

  // Apex exact matches — no site context
  if (APEX_HOSTNAMES.has(hostname)) return null;

  // Bare localhost — no site context
  if (hostname === "localhost") return null;

  // Subdomain of penrosepages.com
  // e.g. "heather.penrosepages.com" → "heather"
  if (hostname.endsWith(".penrosepages.com")) {
    const sub = hostname.slice(0, -".penrosepages.com".length);
    // Guard: "www" is treated as apex alias even if somehow not caught above
    if (sub === "www" || sub === "") return null;
    // Validate format and reject multi-level subdomains
    if (!isValidSubdomain(sub)) return null;
    return sub;
  }

  // Local development: support "heather.localhost"
  if (hostname.endsWith(".localhost")) {
    const sub = hostname.slice(0, -".localhost".length);
    if (sub === "www" || sub === "" || !isValidSubdomain(sub)) return null;
    return sub;
  }

  // Everything else (unknown domains, raw IPs, etc.) — no site context
  return null;
}

export default convexAuthNextjsMiddleware(
  async (request: NextRequest, { convexAuth }) => {
    // OAuth code exchange + cookie sync happen in middleware before our handler runs
    const pathname = request.nextUrl.pathname;

    // ── 1. Site resolution ───────────────────────────────────────────────────
    const host = request.headers.get("host") ?? "";
    const subdomain = extractSubdomain(host);

    // We propagate the subdomain (if any) via a custom request header so that
    // Server Components can read it without parsing the host again.
    // Next.js middleware can forward headers through NextResponse.next().
    const requestHeaders = new Headers(request.headers);
    if (subdomain) {
      requestHeaders.set("x-site-subdomain", subdomain);
    } else {
      // Explicitly remove the header so downstream code sees a clean absence
      requestHeaders.delete("x-site-subdomain");
    }

    // Build the "continue" response with the enriched headers
    const response = NextResponse.next({ request: { headers: requestHeaders } });

    // ── 2. Auth protection (preserved from original) ───────────────────────────
    if (pathname.startsWith("/signin") || pathname.startsWith("/api")) {
      return response;
    }

    if (pathname.startsWith("/app")) {
      const isAuthenticated = await convexAuth.isAuthenticated();

      const referer = request.headers.get("referer");
      const fromLogin = request.nextUrl.searchParams.get("from_login") === "true";

      if (
        (fromLogin || (referer && referer.includes("/signin"))) &&
        !isAuthenticated
      ) {
        return response;
      }

      if (!isAuthenticated) {
        const signInUrl = new URL("/signin", request.url);
        signInUrl.searchParams.set("redirectTo", pathname);
        return NextResponse.redirect(signInUrl);
      }
    }

    return response;
  },
  {
    verbose: process.env.NODE_ENV === "development",
    cookieConfig: { maxAge: 60 * 60 * 24 * 7 }, // 7 days
  }
);

export const config = {
  // Match all routes except Next.js internals and static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

---

## app/layout.tsx

```tsx
/**
 * ⚠️ AUTH FILE - ConvexAuthNextjsServerProvider. DO NOT MODIFY WITHOUT ASKING USER FIRST.
 */
import type { Metadata } from "next";
import { Instrument_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "./ConvexClientProvider";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Penrose",
  description: "Multi-tenant blogging platform",
  icons: {
    icon: "/penrose.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${instrumentSans.variable} ${geistMono.variable} antialiased`}
      >
        <ConvexAuthNextjsServerProvider
          verbose={process.env.NODE_ENV === "development"}
        >
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ConvexAuthNextjsServerProvider>
      </body>
    </html>
  );
}
```

---

## app/ConvexClientProvider.tsx

```tsx
/**
 * ⚠️ AUTH FILE - ConvexAuthNextjsProvider. DO NOT MODIFY WITHOUT ASKING USER FIRST.
 */
"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { ReactNode, useMemo } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL environment variable is not set");
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  // Create the client inside the component to ensure it's initialized with auth context
  // Enable verbose logging in development to debug auth token issues
  const convex = useMemo(
    () =>
      new ConvexReactClient(convexUrl!, {
        verbose: process.env.NODE_ENV === "development",
      }),
    []
  );

  return (
    <ConvexAuthNextjsProvider client={convex}>
      {children}
    </ConvexAuthNextjsProvider>
  );
}
```

---

## app/(app)/layout.tsx

```tsx
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { UserMenu } from "./components/UserMenu";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const orgSlug = params.orgSlug as string | undefined;

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/app" className="font-semibold">
              Penrose
            </Link>
            {orgSlug && (
              <span className="text-sm text-gray-500">
                org: {orgSlug}
              </span>
            )}
          </div>
          <nav className="flex gap-4 items-center">
            {orgSlug ? (
              <>
                <Link
                  href={`/app/${orgSlug}`}
                  className="text-sm hover:underline"
                >
                  Dashboard
                </Link>
                <Link
                  href={`/app/${orgSlug}/posts`}
                  className="text-sm hover:underline"
                >
                  Posts
                </Link>
              </>
            ) : (
              <span className="text-sm text-gray-400">
                Select an organization
              </span>
            )}
            <div className="ml-2 pl-4 border-l border-gray-200">
              <UserMenu />
            </div>
          </nav>
        </div>
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}
```

---

## app/(app)/app/page.tsx

```tsx
"use client";

import { useAuthToken } from "@convex-dev/auth/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";

export default function AppLandingPage() {
  const token = useAuthToken();
  const userInfo = useQuery(api.users.whoami);
  const { signOut } = useAuthActions();
  const router = useRouter();

  // Debug logging
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.log("AppLandingPage - token:", token ? "present" : "missing");
      console.log("AppLandingPage - userInfo:", userInfo);
    }
  }, [token, userInfo]);

  useEffect(() => {
    if (userInfo && userInfo.orgs.length === 0) {
      router.push("/app/onboarding");
    }
  }, [userInfo, router]);

  if (userInfo === undefined) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-gray-500 animate-pulse">Loading...</div>
      </div>
    );
  }

  if (userInfo === null) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-gray-500">Not authenticated</p>
          <button
            onClick={() => signOut()}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-medium transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Welcome back, {userInfo.name}</h1>
      <p className="mt-2 text-gray-600">
        Select an organization from the top bar to manage your content.
      </p>
    </div>
  );
}
```

---

## app/(app)/app/[orgSlug]/page.tsx

```tsx
"use client";

import { useParams } from "next/navigation";
import { useOrgBySlug } from "@/lib/useOrgBySlug";

export default function OrgDashboardPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const org = useOrgBySlug(orgSlug);

  if (org === undefined) {
    return <p className="text-gray-500">Loading organization…</p>;
  }

  if (org === null) {
    return <p className="text-red-600">Org not found</p>;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-gray-600">Organization: {org.name}</p>
      <p className="mt-1 text-sm text-gray-400">ID: {org._id}</p>
    </div>
  );
}
```

---

## app/(app)/app/[orgSlug]/posts/page.tsx

```tsx
"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { useOrgBySlug } from "@/lib/useOrgBySlug";
import { publicPostUrl } from "@/lib/urls";

export default function PostsListPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const org = useOrgBySlug(orgSlug);

  const site = useQuery(
    api.sites.getSiteForOrg,
    org?._id ? { orgId: org._id } : "skip"
  );

  const posts = useQuery(
    api.posts.listPostsForSite,
    site?._id ? { siteId: site._id } : "skip"
  );

  // ── Loading states ─────────────────────────────────────────────────────────
  if (org === undefined) {
    return <p className="text-gray-500 animate-pulse">Loading organization…</p>;
  }
  if (org === null) {
    return <p className="text-red-600">Organization not found.</p>;
  }
  if (site === undefined) {
    return <p className="text-gray-500 animate-pulse">Loading site…</p>;
  }
  if (site === null) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Posts</h1>
        <p className="mt-4 text-gray-600">
          No site has been configured for this organization yet.
        </p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Posts</h1>
        <Link
          href={`/app/${orgSlug}/posts/new`}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          New Post
        </Link>
      </div>

      {posts === undefined ? (
        <p className="text-gray-500 animate-pulse">Loading posts…</p>
      ) : posts.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-gray-300 rounded-lg">
          <p className="text-gray-500">No posts yet.</p>
          <Link
            href={`/app/${orgSlug}/posts/new`}
            className="mt-2 inline-block text-sm text-blue-600 hover:underline"
          >
            Create your first post →
          </Link>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg divide-y divide-gray-200">
          {posts.map((post) => (
            <div
              key={post._id}
              className="p-4 flex items-center justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium truncate">{post.title}</p>
                  {post.status !== "published" && (
                    <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">
                      {post.status}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 font-mono">
                  /p/{post.slug}
                </p>
              </div>
              {post.status === "published" && (
                <a
                  href={publicPostUrl(site.subdomain, post.slug)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 ml-4 text-sm text-blue-600 hover:underline"
                >
                  View&nbsp;→
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## app/(app)/app/[orgSlug]/posts/new/page.tsx

```tsx
"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrgBySlug } from "@/lib/useOrgBySlug";

export default function NewPostPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const router = useRouter();
  const org = useOrgBySlug(orgSlug);

  const site = useQuery(
    api.sites.getSiteForOrg,
    org?._id ? { orgId: org._id } : "skip"
  );

  const createPost = useMutation(api.posts.createPost);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Loading / error states ─────────────────────────────────────────────────
  if (org === undefined || site === undefined) {
    return <p className="text-gray-500 animate-pulse">Loading…</p>;
  }
  if (org === null) {
    return <p className="text-red-600">Organization not found.</p>;
  }
  if (site === null) {
    return (
      <p className="text-red-600">
        No site configured for this organization.
      </p>
    );
  }

  // ── Submit handler ─────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    // Client-side validation
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();

    if (!trimmedTitle) {
      setError("Title is required");
      setIsSubmitting(false);
      return;
    }

    try {
      await createPost({
        orgId: org._id,
        siteId: site._id,
        title: trimmedTitle,
        body: trimmedBody,
      });
      router.push(`/app/${orgSlug}/posts`);
    } catch (err) {
      const message = err instanceof Error 
        ? err.message 
        : "Failed to create post";
      setError(message);
      setIsSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-6">New Post</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="title"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Title
          </label>
          <input
            type="text"
            id="title"
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            placeholder="My first post"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label
            htmlFor="body"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Body
          </label>
          <textarea
            id="body"
            rows={10}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm font-mono"
            placeholder="Write your post content here…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 p-3 rounded border border-red-100">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={isSubmitting || !title.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? "Publishing…" : "Publish"}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/app/${orgSlug}/posts`)}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
```

---

## app/(app)/app/onboarding/page.tsx

```tsx
"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";

export default function OnboardingPage() {
  const createOrg = useMutation(api.orgs.create);
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      // Auto-generate name from slug for simplicity, or we could ask for it too
      const name = slug.charAt(0).toUpperCase() + slug.slice(1);
      
      await createOrg({ name, slug });
      router.push(`/app/${slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create organization");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-xl shadow-sm border border-gray-200">
        <h1 className="text-2xl font-bold mb-2">Welcome to Penrose</h1>
        <p className="text-gray-500 mb-6">Choose a handle to get started.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="slug" className="block text-sm font-medium text-gray-700 mb-1">
              Handle
            </label>
            <div className="flex rounded-md shadow-sm">
              <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 text-gray-500 sm:text-sm">
                penrose.com/
              </span>
              <input
                type="text"
                id="slug"
                required
                pattern="[a-z0-9-]+"
                className="flex-1 min-w-0 block w-full px-3 py-2 rounded-none rounded-r-md border border-gray-300 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="username"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
              />
            </div>
            <p className="mt-1 text-xs text-gray-400">
              Lowercase letters, numbers, and hyphens only.
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 p-2 rounded border border-red-100">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !slug}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Creating..." : "Get Started"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

---

## app/(app)/settings/page.tsx

```tsx
export default function SettingsPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Settings</h1>
      <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
        <p className="text-gray-500">Settings coming soon...</p>
      </div>
    </div>
  );
}
```

---

## app/(app)/components/UserMenu.tsx

```tsx
"use client";

import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";

export function UserMenu() {
  const { signOut } = useAuthActions();
  const token = useAuthToken();
  const user = useQuery(api.users.whoami);
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Debug logging
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.log("UserMenu - token:", token ? "present" : "missing");
      console.log("UserMenu - user:", user);
    }
  }, [token, user]);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Loading state
  if (user === undefined) {
    return (
      <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse" />
    );
  }

  // Not authenticated
  if (user === null) {
    return (
      <Link href="/signin" className="text-sm font-medium text-gray-700 hover:text-gray-900">
        Sign in
      </Link>
    );
  }

  const initial = user.name ? user.name.charAt(0).toUpperCase() : "?";

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
      >
        {user.image ? (
          <img
            src={user.image}
            alt={user.name ?? "User"}
            className="w-8 h-8 rounded-full"
          />
        ) : (
          initial
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 ring-1 ring-black ring-opacity-5 z-50">
          <div className="px-4 py-2 border-b border-gray-100">
            <p className="text-sm font-medium text-gray-900 truncate">
              {user.name}
            </p>
            <p className="text-xs text-gray-500 truncate">{user.email}</p>
          </div>
          
          <Link
            href="/settings"
            className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            onClick={() => setIsOpen(false)}
          >
            Settings
          </Link>
          
          <button
            onClick={() => signOut()}
            className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## app/(public)/layout.tsx

```tsx
import { resolveSite } from "@/lib/resolveSite";

/**
 * Public route group layout.
 *
 * Three modes driven entirely by the middleware-injected subdomain:
 *
 *   1. Apex (no subdomain)   → transparent pass-through, no shell
 *   2. Invalid subdomain     → "Site not found" error, children blocked
 *   3. Valid site resolved   → minimal site header shell wrapping children
 *
 * Pages inside this group can call resolveSite() themselves (the React
 * cache() wrapper deduplicates within the same request) to read site
 * metadata without an extra Convex round-trip.
 */
export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { subdomain, site, error } = await resolveSite();

  // ── Apex: no site context, no shell ────────────────────────────────────────
  if (!subdomain) {
    return <>{children}</>;
  }

  // ── Handle resolution errors gracefully ────────────────────────────────────
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <main className="max-w-md w-full p-8 rounded-xl border border-yellow-200 bg-yellow-50 text-center space-y-3">
          <h1 className="text-2xl font-semibold text-yellow-700">
            Service temporarily unavailable
          </h1>
          <p className="text-yellow-600 text-sm">
            We're having trouble loading this site. Please try again later.
          </p>
        </main>
      </div>
    );
  }

  // ── Invalid subdomain: block child rendering ───────────────────────────────
  if (!site) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <main className="max-w-md w-full p-8 rounded-xl border border-red-200 bg-red-50 text-center space-y-3">
          <h1 className="text-2xl font-semibold text-red-700">
            Site not found
          </h1>
          <p className="text-red-600 text-sm">
            No site is configured for{" "}
            <code className="font-mono bg-red-100 px-1 rounded">
              {subdomain}
            </code>
            .
          </p>
        </main>
      </div>
    );
  }

  // ── Valid site: minimal shell ──────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-gray-200 px-6 py-4 shrink-0">
        <p className="text-lg font-semibold tracking-tight">{site.name}</p>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
```

---

## app/(public)/page.tsx

```tsx
import { resolveSite, ResolvedSite } from "@/lib/resolveSite";

/**
 * Public home page.
 *
 * Behaviour:
 *  - Apex domain (penrosepages.com, www, localhost) → no site context
 *  - Valid subdomain → resolve site and show metadata
 *  - Unknown subdomain → "Site not found" (handled by layout)
 *
 * Note: Uses cached resolveSite() which shares the query with layout.tsx
 * to avoid duplicate Convex round-trips.
 */
export default async function HomePage() {
  // Uses cached resolveSite() - shares query with layout.tsx
  const { host, subdomain, site } = await resolveSite();

  // Note: "Site not found" case is handled by layout.tsx which blocks
  // child rendering. This page only renders when site is resolved or apex.

  // ── Render: apex domain or resolved site ──────────────────────────────────
  return (
    <div className="flex min-h-screen items-center justify-center">
      <main className="max-w-lg w-full p-8 rounded-xl border border-gray-200 bg-white shadow-sm space-y-6">
        {site ? (
          <SiteContext site={site} />
        ) : (
          <ApexContext />
        )}
        <DebugPanel
          host={host}
          subdomain={subdomain}
          lookupAttempted={subdomain !== null}
          site={site}
        />
      </main>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ApexContext() {
  return (
    <div className="space-y-2 text-center">
      <h1 className="text-3xl font-bold tracking-tight">Penrose Pages</h1>
      <p className="text-gray-500">
        A multi-tenant publishing platform.
      </p>
    </div>
  );
}

function SiteContext({
  site,
}: {
  site: ResolvedSite;
}) {
  return (
    <div className="space-y-2 text-center">
      <p className="text-xs uppercase tracking-widest text-gray-400 font-medium">
        You are viewing
      </p>
      <h1 className="text-3xl font-bold tracking-tight">{site.name}</h1>
      <p className="text-gray-500 text-sm font-mono">{site.subdomain}.penrosepages.com</p>
    </div>
  );
}

function DebugPanel({
  host,
  subdomain,
  lookupAttempted,
  site,
}: {
  host: string;
  subdomain: string | null;
  lookupAttempted: boolean;
  site: ResolvedSite | null;
}) {
  // Only render in development to avoid exposing internal IDs in production
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  return (
    <div className="mt-4 rounded-lg bg-gray-50 border border-gray-200 p-4 text-left text-xs font-mono space-y-1">
      <p className="text-gray-400 uppercase tracking-widest text-[10px] mb-2 font-sans font-semibold">
        Resolution debug
      </p>
      <Row label="host" value={host} />
      <Row label="x-site-subdomain" value={subdomain ?? "(none)"} />
      <Row label="lookup attempted" value={lookupAttempted ? "yes" : "no"} />
      <Row
        label="site found"
        value={site ? "yes" : lookupAttempted ? "no" : "n/a"}
      />
      {site && (
        <>
          <Row label="siteId" value={site._id} />
          <Row label="site name" value={site.name} />
          <Row label="orgId" value={site.orgId} />
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-gray-400 select-none">{label}: </span>
      <span className="text-gray-800">{value}</span>
    </p>
  );
}
```

---

## app/(public)/p/[slug]/page.tsx

```tsx
import { fetchQuery } from "convex/nextjs";
import { resolveSite } from "@/lib/resolveSite";
import { api } from "@/convex/_generated/api";

/**
 * Validate slug format: alphanumeric, hyphens, reasonable length.
 * Prevents malformed input and potential issues with database queries.
 */
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/i.test(slug) && slug.length > 0 && slug.length <= 200;
}

/**
 * Public single-post view.
 *
 * Resolution chain:
 *   1. Layout gates invalid subdomains (never reaches this page)
 *   2. This page reads the resolved site from the cached helper
 *   3. Fetches the post by (siteId, slug) — always site-scoped
 *   4. Only published posts are returned by the Convex query
 *
 * Reaching this route on the apex domain (no site context) shows a
 * graceful message rather than crashing — the route only makes sense
 * under a site subdomain, but defensive handling costs nothing.
 */
export default async function PostPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;

  // ── Validate slug before processing ────────────────────────────────────────
  if (!isValidSlug(slug)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500 text-sm">Invalid post URL.</p>
      </div>
    );
  }

  const { site } = await resolveSite();

  // ── No site context (apex domain hit /p/… directly) ────────────────────────
  if (!site) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500 text-sm">
          This page requires a site context. Please visit from a site subdomain.
        </p>
      </div>
    );
  }

  // ── Fetch the post, scoped to this site ────────────────────────────────────
  let post;
  try {
    post = await fetchQuery(api.posts.getPostBySlug, {
      siteId: site._id,
      slug,
    });
  } catch (error) {
    console.error("Failed to fetch post:", error);
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500 text-sm">
          Unable to load this post. Please try again later.
        </p>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12 text-center space-y-2">
        <h1 className="text-2xl font-semibold text-red-700">Post not found</h1>
        <p className="text-red-600 text-sm">
          No published post with slug{" "}
          <code className="font-mono bg-red-100 px-1 rounded">{slug}</code>
          {" "}exists on this site.
        </p>
      </div>
    );
  }

  // ── Render the post ────────────────────────────────────────────────────────
  return (
    <article className="max-w-2xl mx-auto px-6 py-12 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{post.title}</h1>
        <time
          dateTime={new Date(post.createdAt).toISOString()}
          className="block text-sm text-gray-400"
        >
          {new Date(post.createdAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </time>
      </header>

      <div className="prose prose-gray max-w-none">
        {post.body ? (
          <p className="whitespace-pre-wrap">{post.body}</p>
        ) : (
          <p className="italic text-gray-400">This post has no content yet.</p>
        )}
      </div>
    </article>
  );
}
```

---

## app/signin/page.tsx

```tsx
/**
 * ⚠️ AUTH FILE - DO NOT MODIFY WITHOUT ASKING USER FIRST.
 */
"use client";

import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * OAuth code exchange is handled by the Next.js middleware (convexAuthNextjsMiddleware).
 * When the user lands on /signin?code=xxx, the middleware exchanges the code and redirects
 * to /signin (without code) with auth cookies set. The client never sees the code.
 * We only redirect to /app when we have a token (from serverState/cookies).
 */
const REDIRECT_DELAY_MS = 500; // Brief delay for hydration

export default function SignInPage() {
  const { signIn } = useAuthActions();
  const token = useAuthToken();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirectTo") || "/app";

  // Redirect once authenticated (token comes from serverState/cookies set by middleware)
  useEffect(() => {
    if (token) {
      const timeout = setTimeout(() => {
        const destUrl = new URL(redirectTo, window.location.origin);
        destUrl.searchParams.set("from_login", "true");
        window.location.href = destUrl.toString();
      }, REDIRECT_DELAY_MS);
      return () => clearTimeout(timeout);
    }
  }, [token, redirectTo]);
  
  const handleSignIn = async () => {
    setError(null);
    
    // If there's already a token but user is on sign-in page, clear it first
    if (token) {
      if (process.env.NODE_ENV === "development") {
        console.log("handleSignIn: Token present, clearing before sign-in");
      }
      // Clear any existing token/localStorage
      localStorage.removeItem("__convexAuth");
      localStorage.removeItem("__Host-convexAuth");
      // Force a page reload to clear state
      window.location.reload();
      return;
    }
    
    try {
      // Pass the final destination to the provider so it comes back in the callback
      const callbackUrl = new URL(`${window.location.origin}/signin`);
      if (redirectTo) {
        callbackUrl.searchParams.set("redirectTo", redirectTo);
      }
      
      if (process.env.NODE_ENV === "development") {
        console.log("handleSignIn: Calling signIn with callbackUrl:", callbackUrl.toString());
      }
      
      const result = await signIn("google", { redirectTo: callbackUrl.toString() });
      
      if (process.env.NODE_ENV === "development") {
        console.log("handleSignIn: Result:", result);
      }
      
      if (result.redirect) {
        // OAuth flow, redirect to provider
        if (process.env.NODE_ENV === "development") {
          console.log("handleSignIn: OAuth flow, redirecting to:", result.redirect.toString());
        }
        window.location.href = result.redirect.toString();
      } else if (result.signingIn) {
        // Immediate sign-in (shouldn't happen for OAuth, but handle it)
        if (process.env.NODE_ENV === "development") {
          console.log("handleSignIn: Immediate sign-in, redirecting to:", redirectTo);
        }
        const destUrl = new URL(redirectTo, window.location.origin);
        destUrl.searchParams.set("from_login", "true");
        window.location.href = destUrl.toString();
      } else {
        // No redirect URL - this shouldn't happen
        const errorMsg = "Sign in failed: No redirect URL returned";
        if (process.env.NODE_ENV === "development") {
          console.error("handleSignIn: Unexpected result - no redirect:", result);
        }
        setError(errorMsg);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to sign in";
      if (process.env.NODE_ENV === "development") {
        console.error("handleSignIn: Error:", err);
      }
      setError(errorMessage);
    }
  };

  // Loading: middleware is exchanging code and will redirect, or we're redirecting
  if (code || token) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <main className="text-center">
          <h1 className="text-2xl font-semibold mb-4">
            {code ? "Completing sign in..." : "Redirecting..."}
          </h1>
          {error && (
            <p className="text-red-600 mt-4" role="alert">
              {error}
            </p>
          )}
          <p className="text-gray-500 text-sm mt-2">Taking you to {redirectTo}</p>
        </main>
      </div>
    );
  }

  // Sign-in form
  return (
    <div className="flex min-h-screen items-center justify-center">
      <main className="text-center">
        <h1 className="text-2xl font-semibold mb-6">Sign In</h1>
        {error && (
          <p className="text-red-600 mb-4" role="alert">
            {error}
          </p>
        )}
        <button
          onClick={handleSignIn}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          type="button"
        >
          Sign in with Google
        </button>
      </main>
    </div>
  );
}
```

---

## lib/urls.ts

```ts
/**
 * Build the public URL for a post on a tenant site.
 *
 * @param subdomain - The site subdomain (e.g., "acme")
 * @param postSlug - The post slug (e.g., "my-first-post")
 * @returns The full URL (e.g., "https://acme.penrosepages.com/p/my-first-post")
 * @throws Error if subdomain or postSlug is empty
 *
 * Uses NEXT_PUBLIC_ROOT_DOMAIN (e.g. "penrosepages.com") in production
 * and falls back to "localhost:3000" for local development.
 *
 * Works in both server and client components because Next.js inlines
 * NEXT_PUBLIC_* vars at build time.
 */
export function publicPostUrl(subdomain: string, postSlug: string): string {
  if (!subdomain?.trim() || !postSlug?.trim()) {
    throw new Error("Subdomain and postSlug are required");
  }

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";
  const protocol = rootDomain.startsWith("localhost") ? "http" : "https";
  
  return `${protocol}://${subdomain}.${rootDomain}/p/${postSlug}`;
}
```

---

## lib/resolveSite.ts

```ts
import { cache } from "react";
import { headers } from "next/headers";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

/**
 * The subset of site fields returned by the resolution query.
 * Intentionally narrow — no posts, themes, or settings.
 */
export type ResolvedSite = {
  _id: Id<"sites">;
  name: string;
  subdomain: string;
  orgId: Id<"orgs">;
};

export type SiteResolution = {
  host: string;
  subdomain: string | null;
  site: ResolvedSite | null;
  error?: boolean; // Optional: distinguish errors from "not found"
};

/**
 * Read the middleware-injected x-site-subdomain header and, if present,
 * resolve it to a site document via Convex.
 *
 * Wrapped in React `cache()` so that layout.tsx and page.tsx (which both
 * call this in the same RSC render pass) share a single Convex round-trip
 * rather than issuing duplicate queries.
 *
 * Return states:
 *   { subdomain: null, site: null }         — apex domain, no site context
 *   { subdomain: "x",  site: null }         — unknown subdomain
 *   { subdomain: "x",  site: null, error: true } — resolution failed (network/Convex error)
 *   { subdomain: "x",  site: ResolvedSite } — valid site resolved
 */
export const resolveSite = cache(async (): Promise<SiteResolution> => {
  const h = await headers();
  const host = h.get("host") ?? "(unknown)";
  const subdomain = h.get("x-site-subdomain") ?? null;

  if (!subdomain) {
    return { host, subdomain: null, site: null };
  }

  try {
    const site = await fetchQuery(api.sites.getSiteBySubdomain, { subdomain });
    return { host, subdomain, site };
  } catch (error) {
    // Log for monitoring, but don't crash the page
    console.error("Failed to resolve site:", error);
    // Return null site but flag error for potential error boundary handling
    return { host, subdomain, site: null, error: true };
  }
});
```

---

## lib/useOrgBySlug.ts

```ts
"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Resolve an organization by its URL slug via Convex query.
 *
 * Returns:
 *   undefined — query is loading
 *   null     — no org with that slug exists
 *   Doc      — the resolved org document
 *
 * This three-state return leverages Convex's useQuery convention
 * and gives TypeScript clean narrowing in components.
 */
export function useOrgBySlug(slug: string) {
  return useQuery(api.orgs.getBySlug, { slug });
}
```

---

## package.json

```json
{"name":"penrose-app","version":"0.1.0","private":true,"scripts":{"dev":"next dev","build":"next build","start":"next start","lint":"eslint","convex:dev":"convex dev"},"dependencies":{"@auth/core":"^0.37.0","@convex-dev/auth":"^0.0.90","next":"16.1.6","next-auth":"^5.0.0-beta.30","react":"19.2.3","react-dom":"19.2.3"},"devDependencies":{"@tailwindcss/postcss":"^4","@types/node":"^20","@types/react":"^19","@types/react-dom":"^19","convex":"^1.31.7","eslint":"^9","eslint-config-next":"16.1.6","tailwindcss":"^4","typescript":"^5"}}
```

---

## next.config.ts

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
```

---

## tsconfig.json

```json
{"compilerOptions":{"target":"ES2017","lib":["dom","dom.iterable","esnext"],"allowJs":true,"skipLibCheck":true,"strict":true,"noEmit":true,"esModuleInterop":true,"module":"esnext","moduleResolution":"bundler","resolveJsonModule":true,"isolatedModules":true,"jsx":"react-jsx","incremental":true,"plugins":[{"name":"next"}],"paths":{"@/*":["./*"]}},"include":["next-env.d.ts","**/*.ts","**/*.tsx",".next/types/**/*.ts",".next/dev/types/**/*.ts","**/*.mts"],"exclude":["node_modules"]}
```

---

## convex.json

```json
{"functions":"convex/"}
```

---

## convex/tsconfig.json

```json
{
  /* This TypeScript project config describes the environment that
   * Convex functions run in and is used to typecheck them.
   * You can modify it, but some settings are required to use Convex.
   */
  "compilerOptions": {
    /* These settings are not required by Convex and can be modified. */
    "allowJs": true,
    "strict": true,
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true,

    /* These compiler options are required by Convex */
    "target": "ESNext",
    "lib": ["ES2021", "dom"],
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["./**/*"],
  "exclude": ["./_generated"]
}
```

---

## eslint.config.mjs

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
```

---

## scripts/generate-auth-keys.mjs

```js
#!/usr/bin/env node
/**
 * Generate JWT_PRIVATE_KEY and JWKS for Convex Auth.
 * Run: node scripts/generate-auth-keys.mjs
 * Then set the output in Convex: npx convex env set JWT_PRIVATE_KEY "..." JWKS "..."
 */
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const keys = await generateKeyPair("RS256", { extractable: true });
const privateKey = await exportPKCS8(keys.privateKey);
const publicKey = await exportJWK(keys.publicKey);
const jwks = JSON.stringify({ keys: [{ use: "sig", ...publicKey }] });

console.log("\nAdd these to Convex (npx convex env set):\n");
console.log(`JWT_PRIVATE_KEY="${privateKey.trimEnd().replace(/\n/g, " ")}"`);
console.log(`JWKS='${jwks}'`);
console.log("\nOr run: npx convex env set JWT_PRIVATE_KEY \"<paste key>\" JWKS '<paste jwks>'");
```

---
