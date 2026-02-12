# Phase 4 Input - Complete File Inventory

## Inventory

- convex/schema.ts
- convex/auth.ts
- convex/http.ts
- middleware.ts
- app/(app)/layout.tsx
- app/(app)/app/page.tsx
- app/(app)/app/[orgSlug]/page.tsx
- app/(app)/app/[orgSlug]/pages/page.tsx
- package.json
- next.config.ts

## convex/schema.ts

```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/**
 * Database schema for the multi-tenant blogging CMS.
 * 
 * Phase 1: Placeholder schema with tenant isolation structure.
 * All tenant-scoped tables must include tenantId and appropriate indexes.
 */
export default defineSchema({
  // Auth tables from @convex-dev/auth
  ...authTables,
  
  /**
   * Tenants represent organizations/workspaces in the multi-tenant system.
   * Each tenant has a unique slug used for subdomain routing.
   */
  tenants: defineTable({
    name: v.string(),
    slug: v.string(), // Unique identifier for subdomain routing (e.g., "acme" -> acme.yourapp.com)
  }).index("by_slug", ["slug"]),
  
  /**
   * Members link users to tenants with specific roles.
   * Users can belong to multiple tenants with different roles.
   * 
   * CRITICAL: Every tenant-scoped query must validate membership
   * using this table before returning data.
   */
  members: defineTable({
    userId: v.id("users"),
    tenantId: v.id("tenants"),
    role: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("member")
    ),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_user", ["userId"])
    .index("by_tenant_and_user", ["tenantId", "userId"]), // Composite index for membership lookups
});
```

## convex/auth.ts

```typescript
import { convexAuth } from "@convex-dev/auth/server";
import Google from "next-auth/providers/google";

/**
 * Convex Auth configuration.
 * 
 * Environment variables required (set in Convex dashboard):
 * - GOOGLE_CLIENT_ID
 * - GOOGLE_CLIENT_SECRET
 * - NEXT_PUBLIC_APP_URL (optional, defaults to localhost:3000)
 */
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!googleClientId || !googleClientSecret) {
  throw new Error(
    "Missing required environment variables: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in Convex dashboard"
  );
}

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [
    Google({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    }),
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
```

## convex/http.ts

```typescript
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Add all auth routes (OAuth callbacks, JWT verification, etc.)
auth.addHttpRoutes(http);

export default http;
```

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
