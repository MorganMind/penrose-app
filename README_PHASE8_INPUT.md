# Inventory

Phase 8: Minimal authenticated authoring loop (create post → publish to site → render publicly)

## Authenticated App Routes

### app/(app)/layout.tsx

```typescript
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
                  href={`/app/${orgSlug}/pages`}
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

### app/(app)/app/page.tsx

```typescript
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
          {process.env.NODE_ENV === "development" && (
            <p className="text-xs text-gray-400">
              Token: {token ? "present" : "missing"}
            </p>
          )}
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

### app/(app)/app/[orgSlug]/page.tsx

```typescript
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

### app/(app)/app/[orgSlug]/pages/page.tsx

```typescript
"use client";

import { useParams } from "next/navigation";
import { useOrgBySlug } from "@/lib/useOrgBySlug";

export default function PostsPage() {
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
      <h1 className="text-2xl font-semibold">Posts</h1>
      <p className="mt-2 text-gray-600">Organization: {org.name}</p>
      <p className="mt-1 text-sm text-gray-400">ID: {org._id}</p>
    </div>
  );
}
```

### app/(app)/app/onboarding/page.tsx

```typescript
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

### app/(app)/settings/page.tsx

```typescript
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

### app/(app)/components/UserMenu.tsx

```typescript
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

## Convex Schema & Logic

### convex/schema.ts

```typescript
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

### convex/posts.ts

```typescript
import { query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

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

### convex/sites.ts

```typescript
import { query } from "./_generated/server";
import { v } from "convex/values";

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
```

### convex/orgs.ts

```typescript
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
 * Create a new organization and add the current user as the owner.
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

    // Check if slug is taken
    const existing = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();

    if (existing) {
      throw new Error("Slug already taken");
    }

    const orgId = await ctx.db.insert("orgs", {
      name,
      slug,
      createdAt: Date.now(),
    });

    await ctx.db.insert("orgMembers", {
      orgId,
      userId,
      role: "owner",
      createdAt: Date.now(),
    });

    return orgId;
  },
});
```

### convex/users.ts

```typescript
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

## Membership Enforcement

### convex/access.ts

```typescript
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

## Public Rendering (Phase 7 Compatibility)

### app/(public)/p/[slug]/page.tsx

```typescript
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

### app/(public)/layout.tsx

```typescript
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

## Supporting Files

### middleware.ts

```typescript
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
  }
);

export const config = {
  // Match all routes except Next.js internals and static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

### lib/resolveSite.ts

```typescript
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

### lib/useOrgBySlug.ts

```typescript
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

### app/ConvexClientProvider.tsx

```typescript
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

### app/api/auth/[...nextauth]/route.ts

```typescript
import { proxyAuthActionToConvex } from "@convex-dev/auth/nextjs/server";
import { NextRequest } from "next/server";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL environment variable is not set");
}

export async function GET(request: NextRequest) {
  return proxyAuthActionToConvex(request, {
    convexUrl,
  });
}

export async function POST(request: NextRequest) {
  return proxyAuthActionToConvex(request, {
    convexUrl,
  });
}
```

### convex/auth.config.ts

```typescript
import { convexAuth } from "@convex-dev/auth/server";
import Google from "@auth/core/providers/google";

/**
 * Convex Auth configuration.
 * 
 * Environment variables required (set in Convex dashboard via `npx convex env set`):
 * - AUTH_GOOGLE_ID: Your Google OAuth Client ID
 * - AUTH_GOOGLE_SECRET: Your Google OAuth Client Secret
 * 
 * The Google provider will automatically read these from the environment.
 * 
 * Note: This file is imported in Next.js (for the store export), but the auth
 * configuration only runs in Convex where the environment variables are available.
 */
import { action } from "./_generated/server"; // Import action from the generated server code

export const { auth, signIn: signInInternal, signOut: signOutInternal, store } = convexAuth({
  providers: [
    Google,
  ],
  callbacks: {
    async redirect({ redirectTo }) {
      // If redirectTo is a full URL, use it as-is
      if (redirectTo?.startsWith("http")) {
        return redirectTo;
      }

      // Otherwise, redirect to the Next.js app
      const nextJsUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      return redirectTo ? `${nextJsUrl}${redirectTo}` : `${nextJsUrl}/app`;
    },
  },
});

// Expose signIn and signOut as Convex actions
export const signIn = action(signInInternal);
export const signOut = action(signOutInternal);
```

### app/layout.tsx

```typescript
import type { Metadata } from "next";
import { Instrument_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { store } from "@/convex/auth.config";

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
          store={store}
          verbose={process.env.NODE_ENV === "development"}
        >
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ConvexAuthNextjsServerProvider>
      </body>
    </html>
  );
}
```
