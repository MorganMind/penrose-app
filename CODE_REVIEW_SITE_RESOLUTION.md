# Code Review: Site Resolution Hierarchy Implementation

## Quick Summary

**Strengths:**
- ✅ Clean separation of concerns (middleware → header → page → query)
- ✅ Correct Next.js 13+ App Router patterns (`fetchQuery` in Server Component)
- ✅ Minimal query footprint (only essential fields)
- ✅ Well-documented code with clear examples

**Risks:**
- ⚠️ **Missing custom domain support** (schema has `customDomain` field but no resolution logic)
- ⚠️ **No error handling** for Convex query failures
- ⚠️ **Debug panel exposes internal IDs** in production
- ⚠️ **Multi-level subdomain ambiguity** (e.g., "a.b.penrosepages.com" extracts "a.b")

---

## Detailed Suggestions

### 1. Correctness Issues

#### Missing Custom Domain Resolution
**Issue:** The schema includes `customDomain` but middleware only handles subdomains.

**Impact:** Sites with custom domains won't resolve correctly.

**Fix:** Add custom domain lookup in middleware or create a separate resolution path:

```typescript
// In middleware.ts - add after subdomain extraction
const hostname = host.split(":")[0].toLowerCase();
const subdomain = extractSubdomain(host);

// If no subdomain, check if it's a custom domain
// This requires querying Convex, which is expensive in middleware
// Better approach: handle in page component
```

**Recommendation:** Handle custom domain resolution in the page component, not middleware (to avoid blocking middleware with DB queries).

#### No Error Handling for fetchQuery
**Issue:** Network failures or Convex errors will crash the page.

**Current code:**
```typescript
site = await fetchQuery(api.sites.getSiteBySubdomain, {
  subdomain: detectedSubdomain,
});
```

**Fix:**
```typescript
try {
  site = await fetchQuery(api.sites.getSiteBySubdomain, {
    subdomain: detectedSubdomain,
  });
} catch (error) {
  console.error("Failed to resolve site:", error);
  // Option 1: Show error state
  // Option 2: Fall back to apex context
  // Option 3: Show "Site temporarily unavailable"
}
```

#### Multi-Level Subdomain Ambiguity
**Issue:** "a.b.penrosepages.com" extracts "a.b" as subdomain. Is this intentional?

**Current behavior:**
- "heather.penrosepages.com" → "heather" ✅
- "a.b.penrosepages.com" → "a.b" ❓

**Recommendation:** 
- If only single-level subdomains are allowed, validate in `extractSubdomain`:
```typescript
if (sub.includes(".")) {
  // Multi-level subdomain detected - treat as unknown domain
  return null;
}
```
- If multi-level is intentional, document this clearly.

#### Subdomain Format Validation
**Issue:** No validation of subdomain format before querying.

**Recommendation:** Add validation to prevent invalid queries:
```typescript
function isValidSubdomain(subdomain: string): boolean {
  // RFC 1123: alphanumeric + hyphens, 1-63 chars, not starting/ending with hyphen
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain);
}
```

---

### 2. Security Concerns

#### Debug Panel in Production
**Issue:** Debug panel exposes internal IDs (`_id`, `orgId`) which could aid reconnaissance.

**Fix:** Gate behind environment check:
```typescript
function DebugPanel({ ... }) {
  // Only show in development
  if (process.env.NODE_ENV !== "development") {
    return null;
  }
  // ... rest of component
}
```

**Alternative:** Use a feature flag or query parameter:
```typescript
const showDebug = process.env.NODE_ENV === "development" || 
                  searchParams.get("debug") === "true";
```

#### Subdomain Input Sanitization
**Issue:** Subdomain is passed directly to Convex query without validation.

**Status:** Convex likely sanitizes, but defense-in-depth is better.

**Recommendation:** Validate format in middleware before setting header.

---

### 3. Performance Considerations

#### No Caching Strategy
**Issue:** `fetchQuery` runs on every request, even for the same subdomain.

**Recommendation:** Add Next.js caching:
```typescript
// In page.tsx
site = await fetchQuery(
  api.sites.getSiteBySubdomain,
  { subdomain: detectedSubdomain },
  { fetch: { next: { revalidate: 300 } } } // Cache for 5 minutes
);
```

**Note:** Site resolution is relatively static, so caching makes sense.

---

### 4. Best Practices

#### Type Definitions Should Be Shared
**Issue:** `SiteResult` type is defined inline in the page component.

**Recommendation:** Extract to shared types file:
```typescript
// types/site.ts
export type SiteResolutionResult = {
  _id: string;
  name: string;
  subdomain: string;
  orgId: string;
} | null;
```

#### Environment-Aware Debug
**Issue:** Debug panel always renders (just hidden visually in production).

**Fix:** Conditionally render based on environment (see Security section).

#### Custom Domain Support Missing
**Issue:** Schema supports `customDomain` but no resolution logic exists.

**Recommendation:** Add `getSiteByCustomDomain` query and handle in page:
```typescript
// In page.tsx
let site = null;
if (detectedSubdomain) {
  site = await fetchQuery(api.sites.getSiteBySubdomain, { subdomain: detectedSubdomain });
} else {
  // Check if host matches a custom domain
  const hostname = host.split(":")[0].toLowerCase();
  if (!APEX_HOSTNAMES.has(hostname) && hostname !== "localhost") {
    site = await fetchQuery(api.sites.getSiteByCustomDomain, { domain: hostname });
  }
}
```

---

### 5. API Design

#### Error Handling in Query
**Issue:** `getSiteBySubdomain` returns `null` for both "not found" and potential errors.

**Current:** Returns `null` on any failure.

**Recommendation:** Consider explicit error handling:
```typescript
// Option 1: Throw on errors, return null only for not found
// Option 2: Return { site: Site | null, error: string | null }
// Option 3: Keep current (simpler) - handle errors at call site
```

**Status:** Current approach is fine if errors are handled at call site (which they should be).

---

## Recommended Refactored Code

### middleware.ts - Add Subdomain Validation

```typescript
/**
 * Validate subdomain format (RFC 1123 compliant).
 * Allows alphanumeric + hyphens, 1-63 chars, not starting/ending with hyphen.
 */
function isValidSubdomain(subdomain: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain);
}

function extractSubdomain(host: string): string | null {
  const hostname = host.split(":")[0].toLowerCase();
  
  if (APEX_HOSTNAMES.has(hostname)) return null;
  if (hostname === "localhost") return null;
  
  if (hostname.endsWith(".penrosepages.com")) {
    const sub = hostname.slice(0, -".penrosepages.com".length);
    if (sub === "www" || sub === "") return null;
    
    // Validate format and reject multi-level subdomains
    if (!isValidSubdomain(sub) || sub.includes(".")) {
      return null;
    }
    
    return sub;
  }
  
  if (hostname.endsWith(".localhost")) {
    const sub = hostname.slice(0, -".localhost".length);
    if (sub === "www" || sub === "" || !isValidSubdomain(sub) || sub.includes(".")) {
      return null;
    }
    return sub;
  }
  
  return null;
}
```

### app/(public)/page.tsx - Add Error Handling & Environment Gating

```typescript
import { headers } from "next/headers";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

type SiteResult = {
  _id: string;
  name: string;
  subdomain: string;
  orgId: string;
} | null;

export default async function HomePage() {
  const headerStore = await headers();
  const detectedSubdomain = headerStore.get("x-site-subdomain") ?? null;
  const host = headerStore.get("host") ?? "(unknown)";

  let site: SiteResult = null;
  let lookupAttempted = false;
  let lookupError: Error | null = null;

  if (detectedSubdomain) {
    lookupAttempted = true;
    try {
      site = await fetchQuery(
        api.sites.getSiteBySubdomain,
        { subdomain: detectedSubdomain },
        { fetch: { next: { revalidate: 300 } } } // Cache for 5 minutes
      );
    } catch (error) {
      console.error("Failed to resolve site:", error);
      lookupError = error instanceof Error ? error : new Error(String(error));
    }
  }

  // Error state
  if (lookupError) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <main className="max-w-md w-full p-8 rounded-xl border border-yellow-200 bg-yellow-50 text-center space-y-3">
          <h1 className="text-2xl font-semibold text-yellow-700">Service temporarily unavailable</h1>
          <p className="text-yellow-600 text-sm">
            We're having trouble loading this site. Please try again later.
          </p>
        </main>
      </div>
    );
  }

  // Not found state
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
          {process.env.NODE_ENV === "development" && (
            <DebugPanel
              host={host}
              subdomain={detectedSubdomain}
              lookupAttempted={lookupAttempted}
              site={null}
            />
          )}
        </main>
      </div>
    );
  }

  // Success state
  return (
    <div className="flex min-h-screen items-center justify-center">
      <main className="max-w-lg w-full p-8 rounded-xl border border-gray-200 bg-white shadow-sm space-y-6">
        {site ? <SiteContext site={site} /> : <ApexContext />}
        {process.env.NODE_ENV === "development" && (
          <DebugPanel
            host={host}
            subdomain={detectedSubdomain}
            lookupAttempted={lookupAttempted}
            site={site}
          />
        )}
      </main>
    </div>
  );
}

// ... rest of components remain the same
```

### convex/sites.ts - Add Custom Domain Query (Future)

```typescript
/**
 * Resolve a site by its custom domain.
 * Returns null if no site with that custom domain exists.
 */
export const getSiteByCustomDomain = query({
  args: { domain: v.string() },
  handler: async (ctx, { domain }) => {
    const site = await ctx.db
      .query("sites")
      .withIndex("by_custom_domain", (q) => q.eq("customDomain", domain))
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

## Priority Action Items

1. **High Priority:**
   - Add error handling for `fetchQuery` (prevents crashes)
   - Gate debug panel behind `NODE_ENV === "development"` (security)

2. **Medium Priority:**
   - Add subdomain format validation (defense-in-depth)
   - Add caching to `fetchQuery` (performance)
   - Extract type definitions to shared file (maintainability)

3. **Low Priority (Future):**
   - Implement custom domain resolution (matches schema)
   - Add rate limiting for public queries (security)
   - Consider multi-level subdomain policy (clarity)

---

## Testing Recommendations

1. **Edge Cases to Test:**
   - Multi-level subdomains: "a.b.penrosepages.com"
   - Invalid subdomain formats: "heather_blog.penrosepages.com"
   - Network failures during `fetchQuery`
   - Convex service unavailable
   - Empty subdomain string
   - Subdomain with special characters

2. **Environment Tests:**
   - Verify debug panel hidden in production
   - Test localhost subdomain resolution
   - Test apex domain behavior

3. **Performance Tests:**
   - Verify caching works correctly
   - Measure query latency under load

---

## Conclusion

The implementation is **solid and well-architected**. The main gaps are:
1. Error handling (critical for production)
2. Debug panel security (exposes internal data)
3. Custom domain support (schema mismatch)

The suggested improvements are incremental and maintain the existing clean architecture while adding production-ready robustness.
