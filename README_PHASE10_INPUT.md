# Phase 10: Editorial Engine Maturity — Input Snapshot

## Inventory

- app/(app)/app/[orgSlug]/posts/[postId]/edit/page.tsx
- convex/ai.ts
- convex/postRevisions.ts

---

## app/(app)/app/[orgSlug]/posts/[postId]/edit/page.tsx

```tsx
"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrgBySlug } from "@/lib/useOrgBySlug";
import { publicPostUrl } from "@/lib/urls";
import { Id } from "@/convex/_generated/dataModel";

export default function EditPostPage() {
  const { orgSlug, postId } = useParams<{
    orgSlug: string;
    postId: string;
  }>();
  const router = useRouter();
  const org = useOrgBySlug(orgSlug);

  const site = useQuery(
    api.sites.getSiteForOrg,
    org?._id ? { orgId: org._id } : "skip"
  );

  const post = useQuery(
    api.posts.getPost,
    postId ? { postId: postId as Id<"posts"> } : "skip"
  );

  const revisions = useQuery(
    api.postRevisions.listRevisionsForPost,
    postId ? { postId: postId as Id<"posts"> } : "skip"
  );

  const updatePost = useMutation(api.posts.updatePost);
  const publishPost = useMutation(api.posts.publishPost);
  const refinePost = useAction(api.ai.refinePost);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [serverBody, setServerBody] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isRefining, setIsRefining] = useState(false);

  // Sync from server — runs on load and after AI refine updates the post
  useEffect(() => {
    if (post && post.body !== serverBody) {
      setTitle(post.title);
      setBody(post.body ?? "");
      setServerBody(post.body ?? "");
    }
    // Initial load when serverBody is empty
    if (post && serverBody === "" && post.title) {
      setTitle(post.title);
      setBody(post.body ?? "");
      setServerBody(post.body ?? "");
    }
  }, [post?.title, post?.body, serverBody]);

  // ── Loading / error states ───────────────────────────────────────────────
  if (org === undefined || site === undefined || post === undefined) {
    return <p className="text-gray-500 animate-pulse">Loading…</p>;
  }
  if (org === null) {
    return <p className="text-gray-600">Organization not found.</p>;
  }
  if (post === null) {
    return <p className="text-gray-600">Post not found or access denied.</p>;
  }

  const isDraft = post.status === "draft";

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setIsSaving(true);
    setError("");
    try {
      await updatePost({
        postId: post._id,
        title: title.trim(),
        body: body.trim(),
      });
      setServerBody(body.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublish = async () => {
    setIsPublishing(true);
    setError("");
    try {
      // Save any pending edits first
      await updatePost({
        postId: post._id,
        title: title.trim(),
        body: body.trim(),
      });
      await publishPost({ postId: post._id });
      router.push(`/app/${orgSlug}/posts`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish");
      setIsPublishing(false);
    }
  };

  const handleRefine = async () => {
    setIsRefining(true);
    setError("");
    try {
      // Save current edits so the action reads the latest body
      await updatePost({
        postId: post._id,
        title: title.trim(),
        body: body.trim(),
      });
      await refinePost({ postId: post._id });
      // The reactive query will pick up the new body automatically
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refinement failed");
    } finally {
      setIsRefining(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Edit Post</h1>
          <p className="text-sm text-gray-500 mt-1">
            <span className="font-mono">/p/{post.slug}</span>
            <span className="mx-2">·</span>
            <span
              className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                post.status === "published"
                  ? "bg-green-100 text-green-700"
                  : post.status === "draft"
                    ? "bg-yellow-100 text-yellow-700"
                    : "bg-gray-100 text-gray-600"
              }`}
            >
              {post.status}
            </span>
          </p>
        </div>

        {post.status === "published" && site && (
          <a
            href={publicPostUrl(site.subdomain, post.slug)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-gray-600 hover:underline"
          >
            View live →
          </a>
        )}
      </div>

      <div className="space-y-4">
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
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label
            htmlFor="body"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Body
          </label>
          <textarea
            id="body"
            rows={16}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-gray-500 focus:border-gray-500 sm:text-sm font-mono"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        {error && (
          <p className="text-sm text-gray-600 bg-gray-100 p-3 rounded border border-gray-200">
            {error}
          </p>
        )}

        {/* ── Action buttons ──────────────────────────────────────────── */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !title.trim()}
            className="px-4 py-2 bg-gray-800 text-white rounded-md text-sm font-medium hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>

          {isDraft && (
            <button
              type="button"
              onClick={handlePublish}
              disabled={isPublishing || !title.trim()}
              className="px-4 py-2 bg-gray-900 text-white rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isPublishing ? "Publishing…" : "Publish"}
            </button>
          )}

          {isDraft && (
            <button
              type="button"
              onClick={handleRefine}
              disabled={isRefining || !body.trim()}
              className="px-4 py-2 bg-gray-700 text-white rounded-md text-sm font-medium hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isRefining ? "Refining…" : "Refine"}
            </button>
          )}

          <button
            type="button"
            onClick={() => router.push(`/app/${orgSlug}/posts`)}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            Back
          </button>
        </div>
      </div>

      {/* ── Revision history ────────────────────────────────────────────── */}
      {revisions && revisions.length > 0 && (
        <div className="mt-10 border-t border-gray-200 pt-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Revision History
          </h2>
          <div className="space-y-2">
            {revisions.map((rev) => (
              <div
                key={rev._id}
                className="flex items-start gap-3 text-sm p-3 rounded-md bg-gray-50 border border-gray-100"
              >
                <span
                  className={`shrink-0 mt-0.5 px-2 py-0.5 rounded text-xs font-medium ${
                    rev.source === "ai"
                      ? "bg-purple-100 text-purple-700"
                      : rev.source === "initial"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-gray-200 text-gray-600"
                  }`}
                >
                  {rev.source === "ai"
                    ? rev.aiMetadata?.operationType ?? "ai"
                    : rev.source}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-gray-600 truncate">{rev.bodyPreview}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Rev {rev.revisionNumber} ·{" "}
                    {new Date(rev.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## convex/ai.ts

```ts
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";

// ── Prompts ──────────────────────────────────────────────────────────────────

const REFINE_SYSTEM_PROMPT = `You are an expert editor. Refine and improve the following blog post.
Focus on clarity, flow, and engagement while preserving the author's voice and core message.
Return only the improved text with no additional commentary, explanations, or meta-discussion.`;

// ── Provider abstraction ─────────────────────────────────────────────────────

type ModelParams = {
  provider: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
};

async function callModel(params: ModelParams): Promise<string> {
  const { provider, model, systemPrompt, userPrompt } = params;

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set. Run: npx convex env set OPENAI_API_KEY sk-..."
      );
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI API error (${res.status}): ${text}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("Unexpected OpenAI response shape");
    }
    return content;
  }

  throw new Error(`Unknown AI provider: ${provider}`);
}

// ── Actions ──────────────────────────────────────────────────────────────────

/**
 * Send the post body through an AI refinement pass.
 *
 * Flow:
 *   1. Verify auth + membership via getPost query
 *   2. Call the configured model
 *   3. Persist the result as a new revision and update the post body
 *
 * The post's body field is updated atomically with the revision insert,
 * so the edit page's reactive query picks up the change immediately.
 */
export const refinePost = action({
  args: {
    postId: v.id("posts"),
  },
  handler: async (ctx, { postId }): Promise<{ revisionNumber: number }> => {
    // 1. Auth + fetch post (query enforces membership)
    const userInfo = await ctx.runQuery(api.users.whoami);
    if (!userInfo) throw new Error("Unauthenticated");

    const post = await ctx.runQuery(api.posts.getPost, { postId });
    if (!post) throw new Error("Post not found or access denied");

    const bodyToRefine = post.body ?? "";
    if (!bodyToRefine.trim()) {
      throw new Error("Cannot refine an empty post body");
    }

    // 2. Call model
    const provider = process.env.AI_PROVIDER ?? "openai";
    const model = process.env.AI_MODEL ?? "gpt-4o-mini";

    const refinedBody = await callModel({
      provider,
      model,
      systemPrompt: REFINE_SYSTEM_PROMPT,
      userPrompt: bodyToRefine,
    });

    // 3. Save revision + update post
    const result = await ctx.runMutation(
      internal.postRevisions.saveRefinement,
      {
        postId,
        body: refinedBody,
        authorId: userInfo.userId,
        aiMetadata: {
          provider,
          model,
          operationType: "refine",
          prompt: REFINE_SYSTEM_PROMPT,
        },
      }
    );

    return { revisionNumber: result.revisionNumber };
  },
});
```

---

## convex/postRevisions.ts

```ts
import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgMember } from "./access";

/**
 * Persist an AI-generated revision and update the post body atomically.
 *
 * Internal-only — called exclusively by AI actions after a successful
 * model call. No client can invoke this directly.
 */
export const saveRefinement = internalMutation({
  args: {
    postId: v.id("posts"),
    body: v.string(),
    authorId: v.id("users"),
    aiMetadata: v.object({
      provider: v.string(),
      model: v.string(),
      operationType: v.string(),
      prompt: v.string(),
    }),
  },
  handler: async (ctx, { postId, body, authorId, aiMetadata }) => {
    const post = await ctx.db.get(postId);
    if (!post) throw new Error("Post not found");

    // Determine next revision number
    const latestRevision = await ctx.db
      .query("postRevisions")
      .withIndex("by_post_and_revision", (q) => q.eq("postId", postId))
      .order("desc")
      .first();

    const revisionNumber = (latestRevision?.revisionNumber ?? 0) + 1;

    await ctx.db.insert("postRevisions", {
      postId,
      body,
      source: "ai",
      aiMetadata,
      revisionNumber,
      createdAt: Date.now(),
      authorId,
    });

    // Update the post's working copy
    await ctx.db.patch(postId, {
      body,
      updatedAt: Date.now(),
    });

    return { revisionNumber };
  },
});

/**
 * List every revision for a post, newest first.
 *
 * Authenticated — caller must be a member of the post's org.
 */
export const listRevisionsForPost = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post) return [];

    await requireOrgMember(ctx, post.orgId);

    const revisions = await ctx.db
      .query("postRevisions")
      .withIndex("by_post_and_revision", (q) => q.eq("postId", postId))
      .order("desc")
      .collect();

    return revisions.map((r) => ({
      _id: r._id,
      revisionNumber: r.revisionNumber,
      source: r.source,
      aiMetadata: r.aiMetadata,
      createdAt: r.createdAt,
      bodyPreview: r.body.slice(0, 120),
    }));
  },
});
```
