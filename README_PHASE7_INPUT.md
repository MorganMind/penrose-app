# Inventory

- middleware.ts
- convex/sites.ts
- app/(public)/page.tsx

## middleware.ts

```typescript
import {
  convexAuthNextjsMiddleware,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

/** Domains that are always treated as the apex (no site context). */
const APEX_HOSTNAMES = new Set(["penrosepages.com", "www.penrosepages.com"]);

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
    return sub;
  }

  // Local development: support "heather.localhost"
  if (hostname.endsWith(".localhost")) {
    const sub = hostname.slice(0, -".localhost".length);
    if (sub === "www" || sub === "") return null;
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

    // ── 2. Auth protection (unchanged from original) ─────────────────────────
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
        return nextjsMiddlewareRedirect(request, "/signin");
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

## convex/sites.ts

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

## app/(public)/page.tsx

```typescript
import { headers } from "next/headers";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

/**
 * Public home page.
 *
 * Behaviour:
 *  - Apex domain (penrosepages.com, www, localhost) → no site context
 *  - Valid subdomain → resolve site and show metadata
 *  - Unknown subdomain → "Site not found"
 */
export default async function HomePage() {
  const headerStore = await headers();

  // The middleware sets this header when a subdomain is detected
  const detectedSubdomain = headerStore.get("x-site-subdomain") ?? null;

  // The raw host is always present — useful for debugging
  const host = headerStore.get("host") ?? "(unknown)";

  // Only query Convex when there is actually a subdomain to look up
  type SiteResult = {
    _id: string;
    name: string;
    subdomain: string;
    orgId: string;
  } | null;

  let site: SiteResult = null;
  let lookupAttempted = false;

  if (detectedSubdomain) {
    lookupAttempted = true;
    site = await fetchQuery(api.sites.getSiteBySubdomain, {
      subdomain: detectedSubdomain,
    });
  }

  // ── Render: subdomain present but no matching site ────────────────────────
  if (lookupAttempted && !site) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <main className="max-w-md w-full p-8 rounded-xl border border-red-200 bg-red-50 text-center space-y-3">
          <h1 className="text-2xl font-semibold text-red-700">Site not found</h1>
          <p className="text-red-600 text-sm">
            No site is configured for{" "}
            <code className="font-mono bg-red-100 px-1 rounded">
              {detectedSubdomain}
            </code>
            .
          </p>
          <DebugPanel
            host={host}
            subdomain={detectedSubdomain}
            lookupAttempted={lookupAttempted}
            site={null}
          />
        </main>
      </div>
    );
  }

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
          subdomain={detectedSubdomain}
          lookupAttempted={lookupAttempted}
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
  site: NonNullable<{
    _id: string;
    name: string;
    subdomain: string;
    orgId: string;
  }>;
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
  site: { _id: string; name: string; subdomain: string; orgId: string } | null;
}) {
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
