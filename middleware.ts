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
