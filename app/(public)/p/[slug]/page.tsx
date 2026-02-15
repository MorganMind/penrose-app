import { fetchQuery } from "convex/nextjs";
import { resolveSite } from "@/lib/resolveSite";
import { api } from "@/convex/_generated/api";
import { markdownToHtml } from "@/lib/markdown";

/**
 * Validate slug format: alphanumeric, hyphens, reasonable length.
 * Prevents malformed input and potential issues with database queries.
 */
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/i.test(slug) && slug.length > 0 && slug.length <= 200;
}

/**
 * Public single-post view.
 *
 * Resolution chain:
 *   1. Layout gates invalid subdomains (never reaches this page)
 *   2. This page reads the resolved site from the cached helper
 *   3. Fetches the post by (siteId, slug) — always site-scoped
 *   4. Only published posts are returned by the Convex query
 *
 * Reaching this route on the apex domain (no site context) shows a
 * graceful message rather than crashing — the route only makes sense
 * under a site subdomain, but defensive handling costs nothing.
 */
export default async function PostPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;

  // ── Validate slug before processing ────────────────────────────────────────
  if (!isValidSlug(slug)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500 text-sm">Invalid post URL.</p>
      </div>
    );
  }

  const { site } = await resolveSite();

  // ── No site context (apex domain hit /p/… directly) ────────────────────────
  if (!site) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500 text-sm">
          This page requires a site context. Please visit from a site subdomain.
        </p>
      </div>
    );
  }

  // ── Fetch the post, scoped to this site ────────────────────────────────────
  let post;
  try {
    post = await fetchQuery(api.posts.getPostBySlug, {
      siteId: site._id,
      slug,
    });
  } catch (error) {
    console.error("Failed to fetch post:", error);
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500 text-sm">
          Unable to load this post. Please try again later.
        </p>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12 text-center space-y-2">
        <h1 className="text-2xl font-semibold text-gray-700">Post not found</h1>
        <p className="text-gray-600 text-sm">
          No published post with slug{" "}
          <code className="font-mono bg-gray-200 px-1 rounded">{slug}</code>
          {" "}exists on this site.
        </p>
      </div>
    );
  }

  // ── Render the post ────────────────────────────────────────────────────────
  return (
    <article className="max-w-2xl mx-auto px-6 py-12 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{post.title}</h1>
        <time
          dateTime={new Date(post.createdAt).toISOString()}
          className="block text-sm text-gray-400"
        >
          {new Date(post.createdAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </time>
      </header>

      <div className="prose prose-gray max-w-none">
        {post.body ? (
          <div dangerouslySetInnerHTML={{ __html: markdownToHtml(post.body) }} />
        ) : (
          <p className="italic text-gray-400">This post has no content yet.</p>
        )}
      </div>
    </article>
  );
}
