# Code Review Response

## Quick Summary

**Strengths:**
- Clean separation of concerns between middleware and page
- Correct use of Server Components with `fetchQuery`
- Minimal query design in `getSiteBySubdomain`
- Good documentation and comments

**Critical Risks:**
1. **Removed subdomain validation** — security/robustness regression
2. **Lost redirect preservation** — UX regression (users won't return to intended page)
3. **Duplicate Convex queries** — performance regression (layout already queries)
4. **Breaking change** — conflicts with existing `resolveSite()` pattern

---

## Detailed Suggestions

### 1. Correctness — Critical Issues

#### a) Missing Subdomain Validation
**Issue:** The proposed middleware removes `isValidSubdomain()` validation that exists in current code.

**Impact:**
- Allows invalid subdomains like `a.b.penrosepages.com` (multi-level)
- Permits malformed subdomains like `--invalid--.penrosepages.com`
- Could cause database query issues or unexpected behavior
- Violates RFC 1123 hostname standards

**Current code validates; proposed code does not.**

#### b) Lost Redirect Preservation
**Issue:** Current middleware preserves `redirectTo` parameter; proposed code does not.

**Current (lines 108-110):**
```typescript
const signInUrl = new URL("/signin", request.url);
signInUrl.searchParams.set("redirectTo", pathname);
return NextResponse.redirect(signInUrl);
```

**Proposed:**
```typescript
return nextjsMiddlewareRedirect(request, "/signin");
```

**Impact:** Users won't be redirected back to their intended page after sign-in.

#### c) Duplicate Convex Queries
**Issue:** `app/(public)/layout.tsx` already calls `resolveSite()` (which is cached). The proposed `page.tsx` makes a separate `fetchQuery` call instead of reusing the cached result.

**Impact:** Unnecessary database round-trip on every page load.

### 2. Performance

- **Duplicate queries:** Layout calls `resolveSite()` (cached), but new page.tsx doesn't use it, causing separate `fetchQuery` call
- **Missing React cache:** Proposed page code doesn't use `cache()`, so multiple components would duplicate queries

### 3. Security

- **Subdomain validation removal:** Without validation, malicious/malformed subdomains could reach database query layer
- **Header injection:** `x-site-subdomain` header is set from user-controlled input (Host header). While expected, subdomain should be validated before use

### 4. Best Practices

- **Breaking existing pattern:** Codebase uses `resolveSite()` for site resolution; proposed page.tsx breaks this
- **Inconsistent error handling:** Layout handles "site not found" by blocking children; proposed page also handles it (duplicate logic)

### 5. API Design

- **`getSiteBySubdomain` is fine:** Returns minimal fields as intended
- **Missing input validation:** Query doesn't validate subdomain format before querying. Consider validating in query handler or ensuring middleware validation

---

## Refactored Version

### middleware.ts (Fixed)

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
        // Preserve redirectTo parameter for post-login redirect
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

**Key changes:**
1. ✅ Restored `isValidSubdomain()` validation
2. ✅ Preserved `redirectTo` parameter in auth redirect
3. ✅ Kept all existing auth protection logic

### app/(public)/page.tsx (Fixed)

**Option A: Use existing `resolveSite()` pattern (Recommended)**

```typescript
import { resolveSite } from "@/lib/resolveSite";

/**
 * Public home page.
 *
 * Behaviour:
 *  - Apex domain (penrosepages.com, www, localhost) → no site context
 *  - Valid subdomain → resolve site and show metadata
 *  - Unknown subdomain → "Site not found" (handled by layout)
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

**Key changes:**
1. ✅ Uses existing `resolveSite()` pattern (cached, shared with layout)
2. ✅ Removes duplicate "Site not found" handling (layout handles it)
3. ✅ Maintains consistency with rest of codebase

**Option B: If you must use direct `fetchQuery` (not recommended)**

If you really want to avoid `resolveSite()`, at minimum wrap it in `cache()`:

```typescript
import { cache } from "react";
import { headers } from "next/headers";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

// Cache the query to avoid duplicates
const getSiteData = cache(async () => {
  const headerStore = await headers();
  const detectedSubdomain = headerStore.get("x-site-subdomain") ?? null;
  const host = headerStore.get("host") ?? "(unknown)";

  let site = null;
  if (detectedSubdomain) {
    site = await fetchQuery(api.sites.getSiteBySubdomain, {
      subdomain: detectedSubdomain,
    });
  }

  return { host, subdomain: detectedSubdomain, site };
});

export default async function HomePage() {
  const { host, subdomain, site } = await getSiteData();
  // ... rest of component
}
```

### convex/sites.ts

**No changes needed** — this file is already correct and matches the proposed code.

**Optional enhancement:** Add input validation in the query handler:

```typescript
export const getSiteBySubdomain = query({
  args: { subdomain: v.string() },
  handler: async (ctx, { subdomain }) => {
    // Validate subdomain format (defense in depth)
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain) || subdomain.includes(".")) {
      return null;
    }

    const site = await ctx.db
      .query("sites")
      .withIndex("by_subdomain", (q) => q.eq("subdomain", subdomain))
      .unique();

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

## Summary of Required Fixes

1. ✅ **Restore subdomain validation** in middleware
2. ✅ **Preserve redirectTo parameter** in auth redirect
3. ✅ **Use `resolveSite()` pattern** in page.tsx (or at minimum wrap in `cache()`)
4. ✅ **Remove duplicate "Site not found" handling** (layout already handles it)
5. ⚠️ **Optional:** Add input validation in `getSiteBySubdomain` query handler

The proposed code has good architectural decisions but needs these fixes to maintain security, performance, and consistency with the existing codebase.
