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
        <main className="max-w-md w-full p-8 rounded-xl border border-gray-200 bg-gray-50 text-center space-y-3">
          <h1 className="text-2xl font-semibold text-gray-700">
            Service temporarily unavailable
          </h1>
          <p className="text-gray-600 text-sm">
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
        <main className="max-w-md w-full p-8 rounded-xl border border-gray-200 bg-gray-50 text-center space-y-3">
          <h1 className="text-2xl font-semibold text-gray-700">
            Site not found
          </h1>
          <p className="text-gray-600 text-sm">
            No site is configured for{" "}
            <code className="font-mono bg-gray-200 px-1 rounded">
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
