"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrgBySlug } from "@/lib/useOrgBySlug";
import { PenroseEditor } from "@/components/editor/PenroseEditor";

export default function NewPostPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const router = useRouter();
  const org = useOrgBySlug(orgSlug);

  const site = useQuery(
    api.sites.getSiteForOrg,
    org?._id ? { orgId: org._id } : "skip"
  );

  const createPost = useMutation(api.posts.createPost);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Loading / error states ─────────────────────────────────────────────────
  if (org === undefined || site === undefined) {
    return <p className="text-gray-500 animate-pulse">Loading…</p>;
  }
  if (org === null) {
    return <p className="text-gray-600">Organization not found.</p>;
  }
  if (site === null) {
    return (
      <p className="text-gray-600">
        No site configured for this organization.
      </p>
    );
  }

  // ── Submit handler ─────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required");
      setIsSubmitting(false);
      return;
    }

    try {
      const postId = await createPost({
        orgId: org._id,
        siteId: site._id,
        title: trimmedTitle,
        body: body.trim(),
      });
      // Redirect to the edit page for the new draft
      router.push(`/app/${orgSlug}/posts/${postId}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create post");
      setIsSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-[680px] mx-auto">
      <h1 className="text-2xl font-semibold mb-6">New Post</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="title"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Title
          </label>
          <input
            type="text"
            id="title"
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
            placeholder="My first post"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label
            htmlFor="body"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Body <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <div className="border border-gray-300 rounded-md overflow-hidden">
            <PenroseEditor
              initialMarkdown={body}
              onChangeMarkdown={setBody}
              placeholder="Write your post content here…"
              className="px-3 py-2 min-h-[200px]"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-gray-600 bg-gray-100 p-3 rounded border border-gray-200">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={isSubmitting || !title.trim()}
            className="px-4 py-2 bg-gray-900 text-white rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? "Creating…" : "Create Draft"}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/app/${orgSlug}/posts`)}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
