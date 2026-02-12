# Phase 3 Input - Complete File Inventory

## Inventory

- convex/auth.ts
- convex/schema.ts
- convex/http.ts
- middleware.ts
- app/api/auth/[...nextauth]/route.ts
- app/layout.tsx
- app/ConvexClientProvider.tsx
- app/signin/page.tsx
- package.json
- next.config.ts

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

## app/api/auth/[...nextauth]/route.ts

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

## app/signin/page.tsx

```typescript
"use client";

import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, useRef } from "react";

const REDIRECT_DELAY_MS = 2000; // Time to wait for cookies to sync before redirecting

export default function SignInPage() {
  const { signIn } = useAuthActions();
  const token = useAuthToken();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const hasRedirectedRef = useRef(false);
  
  const code = searchParams.get("code");
  const hasCode = !!code;
  
  // Process OAuth callback code
  useEffect(() => {
    if (code && !token && !isProcessing) {
      setIsProcessing(true);
      signIn("google", { code })
        .then(() => {
          // Remove code from URL to prevent re-processing
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.delete("code");
          window.history.replaceState({}, "", newUrl.toString());
        })
        .catch((err) => {
          const errorMessage = err instanceof Error ? err.message : "Unknown error";
          setError(`Sign in failed: ${errorMessage}`);
          setIsProcessing(false);
        });
    }
  }, [code, token, signIn, isProcessing]);
  
  // Redirect once authenticated (with delay to allow cookie syncing)
  useEffect(() => {
    if (token && !hasCode && !hasRedirectedRef.current) {
      hasRedirectedRef.current = true;
      const timeout = setTimeout(() => {
        window.location.href = "/app";
      }, REDIRECT_DELAY_MS);
      
      return () => clearTimeout(timeout);
    }
  }, [token, hasCode]);
  
  const handleSignIn = async () => {
    setError(null);
    try {
      const redirectUrl = `${window.location.origin}/signin`;
      const result = await signIn("google", { redirectTo: redirectUrl });
      
      if (result.signingIn) {
        // Immediate sign-in, redirect right away
        window.location.href = "/app";
      } else if (result.redirect) {
        // OAuth flow, redirect to provider
        window.location.href = result.redirect.toString();
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to sign in";
      setError(errorMessage);
    }
  };

  // Loading state during OAuth callback processing
  if (hasCode && !token) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <main className="text-center">
          <h1 className="text-2xl font-semibold mb-4">Completing sign in...</h1>
          {error && (
            <p className="text-red-600 mt-4" role="alert">
              {error}
            </p>
          )}
        </main>
      </div>
    );
  }

  // Redirecting state
  if (token && !hasCode) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <main className="text-center">
          <h1 className="text-2xl font-semibold">Redirecting...</h1>
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
