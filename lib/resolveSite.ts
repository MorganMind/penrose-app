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
