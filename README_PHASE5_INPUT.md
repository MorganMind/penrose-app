# Phase 5 Input - Complete File Inventory

## Inventory

- middleware.ts
- convex/schema.ts
- convex/access.ts
- convex/users.ts
- app/layout.tsx
- app/ConvexClientProvider.tsx
- app/(app)/layout.tsx
- app/(app)/app/page.tsx
- app/(app)/app/[orgSlug]/page.tsx
- app/(app)/app/[orgSlug]/pages/page.tsx
- package.json
- next.config.ts

## middleware.ts

```typescript
import { convexAuthNextjsMiddleware, nextjsMiddlewareRedirect } from "@convex-dev/auth/nextjs/server";
import { NextRequest } from "next/server";

/**
 * Middleware to protect authenticated routes.
 * 
 * NOTE: The referer-based workaround below is a temporary solution for Phase 1.
 * It has a security flaw (referer can be spoofed) and should be replaced with
 * proper cookie syncing in future phases.
 */
export default convexAuthNextjsMiddleware(
  async (request: NextRequest, { convexAuth }) => {
    const pathname = request.nextUrl.pathname;
    
    // Allow access to sign-in page and API routes
    if (pathname.startsWith("/signin") || pathname.startsWith("/api")) {
      return;
    }
    
    // Protect routes that start with /app
    if (pathname.startsWith("/app")) {
      const isAuthenticated = await convexAuth.isAuthenticated();
      
      // TODO: Remove this workaround once cookie syncing is properly implemented
      // This is a temporary fix for Phase 1 to prevent redirect loops.
      // SECURITY NOTE: Referer header can be spoofed - this is not a secure solution.
      // In production, ensure ConvexAuthNextjsServerProvider properly syncs
      // localStorage tokens to HTTP-only cookies that middleware can read.
      const referer = request.headers.get("referer");
      if (referer && referer.includes("/signin") && !isAuthenticated) {
        // Allow one redirect attempt from sign-in to break the loop
        // This should be removed once cookie syncing works correctly
        return;
      }
      
      if (!isAuthenticated) {
        return nextjsMiddlewareRedirect(request, "/signin");
      }
    }
  }
);
```

## convex/schema.ts

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

## convex/access.ts

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

## convex/users.ts

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
      orgs,
    };
  },
});
```

## app/layout.tsx

```typescript
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "./ConvexClientProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CMS Scaffold",
  description: "Multi-tenant blogging CMS",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ConvexAuthNextjsServerProvider verbose={process.env.NODE_ENV === "development"}>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ConvexAuthNextjsServerProvider>
      </body>
    </html>
  );
}
```

## app/ConvexClientProvider.tsx

```typescript
"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL environment variable is not set");
}

const convex = new ConvexReactClient(convexUrl);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexAuthNextjsProvider client={convex}>
      {children}
    </ConvexAuthNextjsProvider>
  );
}
```

## app/(app)/layout.tsx

```typescript
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const orgSlug = params.orgSlug as string | undefined;

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/app" className="font-semibold">
              CMS
            </Link>
            {orgSlug && (
              <span className="text-sm text-gray-500">
                org: {orgSlug}
              </span>
            )}
          </div>
          <nav className="flex gap-4">
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
          </nav>
        </div>
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}
```

## app/(app)/app/page.tsx

```typescript
export default function AppLandingPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">App Landing</h1>
      <p className="mt-2 text-gray-600">
        Select or create an organization to get started.
      </p>
    </div>
  );
}
```

## app/(app)/app/[orgSlug]/page.tsx

```typescript
export default async function OrgDashboardPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-gray-600">Organization: {orgSlug}</p>
    </div>
  );
}
```

## app/(app)/app/[orgSlug]/pages/page.tsx

```typescript
export default async function PostsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Posts</h1>
      <p className="mt-2 text-gray-600">Posts for organization: {orgSlug}</p>
    </div>
  );
}
```

## package.json

```json
{
  "name": "penrose-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "convex:dev": "convex dev"
  },
  "dependencies": {
    "@auth/core": "^0.37.0",
    "@convex-dev/auth": "^0.0.90",
    "next": "16.1.6",
    "next-auth": "^5.0.0-beta.30",
    "react": "19.2.3",
    "react-dom": "19.2.3"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "convex": "^1.31.7",
    "eslint": "^9",
    "eslint-config-next": "16.1.6",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}
```

## next.config.ts

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
```
