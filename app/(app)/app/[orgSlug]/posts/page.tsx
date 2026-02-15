"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { useOrgBySlug } from "@/lib/useOrgBySlug";
import { publicPostUrl } from "@/lib/urls";

const STATUSES = ["all", "draft", "scheduled", "published", "archived"] as const;
type StatusFilter = (typeof STATUSES)[number];

export default function PostsListPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const router = useRouter();
  const org = useOrgBySlug(orgSlug);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [isCreatingSite, setIsCreatingSite] = useState(false);
  const [createSiteError, setCreateSiteError] = useState("");

  const createDefaultSite = useMutation(api.sites.createDefaultSiteForOrg);

  const site = useQuery(
    api.sites.getSiteForOrg,
    org?._id ? { orgId: org._id } : "skip"
  );

  const posts = useQuery(
    api.posts.listPostsForSite,
    site?._id
      ? {
          siteId: site._id,
          ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        }
      : "skip"
  );

  // ── Loading states ─────────────────────────────────────────────────────────
  if (org === undefined) {
    return <p className="text-gray-500 animate-pulse">Loading organization…</p>;
  }
  if (org === null) {
    return <p className="text-gray-600">Organization not found.</p>;
  }
  if (site === undefined) {
    return <p className="text-gray-500 animate-pulse">Loading site…</p>;
  }
  if (site === null) {
    const handleCreateDefaultSite = async () => {
      if (!org) return;
      setIsCreatingSite(true);
      setCreateSiteError("");
      try {
        await createDefaultSite({ orgId: org._id });
      } catch (err) {
        setCreateSiteError(
          err instanceof Error ? err.message : "Failed to create site"
        );
      } finally {
        setIsCreatingSite(false);
      }
    };

    return (
      <div>
        <h1 className="text-2xl font-semibold">Posts</h1>
        <p className="mt-4 text-gray-600">
          No site has been configured for this organization yet.
        </p>
        <button
          onClick={handleCreateDefaultSite}
          disabled={isCreatingSite}
          className="mt-4 px-4 py-2 bg-gray-900 text-white rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isCreatingSite ? "Creating…" : "Create default site"}
        </button>
        {createSiteError && (
          <p className="mt-2 text-sm text-gray-600">{createSiteError}</p>
        )}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Posts</h1>
        <Link
          href={`/app/${orgSlug}/posts/new`}
          className="px-4 py-2 bg-gray-900 text-white rounded-md text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          New Post
        </Link>
      </div>

      {/* ── Status filter ───────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-4">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              statusFilter === s
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Post list ───────────────────────────────────────────────────── */}
      {posts === undefined ? (
        <p className="text-gray-500 animate-pulse">Loading posts…</p>
      ) : posts.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-gray-300 rounded-lg">
          <p className="text-gray-500">
            {statusFilter === "all"
              ? "No posts yet."
              : `No ${statusFilter} posts.`}
          </p>
          {statusFilter === "all" && (
            <Link
              href={`/app/${orgSlug}/posts/new`}
              className="mt-2 inline-block text-sm text-gray-600 hover:underline"
            >
              Create your first post →
            </Link>
          )}
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg divide-y divide-gray-200">
          {posts.map((post) => (
            <div
              key={post._id}
              className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => router.push(`/app/${orgSlug}/posts/${post._id}/edit`)}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/app/${orgSlug}/posts/${post._id}/edit`}
                    className="font-medium truncate hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {post.title}
                  </Link>
                  <span
                    className={`shrink-0 px-2 py-0.5 text-xs font-medium rounded ${
                      post.status === "published"
                        ? "bg-green-100 text-green-700"
                        : post.status === "draft"
                          ? "bg-yellow-100 text-yellow-700"
                          : post.status === "scheduled"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {post.status}
                  </span>
                </div>
                <p className="text-sm text-gray-500 font-mono">/p/{post.slug}</p>
              </div>

              <div className="shrink-0 ml-4 flex items-center gap-3">
                <Link
                  href={`/app/${orgSlug}/posts/${post._id}/edit`}
                  className="text-sm text-gray-600 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  Edit
                </Link>
                {post.status === "published" && (
                  <a
                    href={publicPostUrl(site.subdomain, post.slug)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-gray-600 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View →
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
