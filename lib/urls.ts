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
