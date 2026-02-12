import { resolveSite, ResolvedSite } from "@/lib/resolveSite";

/**
 * Public home page.
 *
 * Behaviour:
 *  - Apex domain (penrosepages.com, www, localhost) → no site context
 *  - Valid subdomain → resolve site and show metadata
 *  - Unknown subdomain → "Site not found" (handled by layout)
 *
 * Note: Uses cached resolveSite() which shares the query with layout.tsx
 * to avoid duplicate Convex round-trips.
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
  site: ResolvedSite;
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
  site: ResolvedSite | null;
}) {
  // Only render in development to avoid exposing internal IDs in production
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

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
