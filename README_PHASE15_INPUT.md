# Phase 15: Minimal Extraction — Real-Time Editing UI Scaffolding (B3 v0)

**Interaction + UI Only.** No backend scoring/enforcement changes.

Complete contents of the minimal set of files required to implement real-time editing UI scaffolding: toggle, triggers, ghost suggestion rendering, accept/dismiss keyboard handling.

---

## 1) Editor surface + state

### app/(app)/app/[orgSlug]/posts/[postId]/edit/page.tsx

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrgBySlug } from "@/lib/useOrgBySlug";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { publicPostUrl } from "@/lib/urls";
import { Id } from "@/convex/_generated/dataModel";
import { EditorialMode, EDITORIAL_MODES } from "@/convex/lib/prompts";
import { NudgeDirection } from "@/convex/lib/nudges";
import { SuggestionDiff } from "./components/SuggestionDiff";
import { VoiceScratchpad } from "./components/VoiceScratchpad";

// ── Suggestion state type ────────────────────────────────────────────────────

type SuggestionPayload = {
  mode: EditorialMode;
  originalText: string;
  suggestedText: string;
  provider: string;
  model: string;
  promptVersion: string;
  nudgeDirection?: string;
  runId?: Id<"editorialRuns">;
  hasAlternate?: boolean;
};

// ── Component ────────────────────────────────────────────────────────────────

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

  const typedPostId = postId as Id<"posts">;

  const post = useQuery(
    api.posts.getPost,
    postId ? { postId: typedPostId } : "skip"
  );

  const revisions = useQuery(
    api.postRevisions.listRevisionsForPost,
    postId ? { postId: typedPostId } : "skip"
  );

  // ── Mutations & actions ────────────────────────────────────────────────
  const updatePost = useMutation(api.posts.updatePost);
  const publishPost = useMutation(api.posts.publishPost);
  const unpublishPost = useMutation(api.posts.unpublishPost);
  const restoreRevision = useMutation(api.postRevisions.restoreRevision);
  const recordNudge = useMutation(api.voiceReactions.recordNudge);
  const refineDevelopmental = useAction(api.ai.refineDevelopmental);
  const refineLine = useAction(api.ai.refineLine);
  const refineCopy = useAction(api.ai.refineCopy);
  const refineWithNudge = useAction(api.ai.refineWithNudge);
  const tryAgainFromRun = useAction(api.ai.tryAgainFromRun);

  // ── Editor state ───────────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [serverTitle, setServerTitle] = useState("");
  const [serverBody, setServerBody] = useState("");
  const [initialised, setInitialised] = useState(false);

  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isUnpublishing, setIsUnpublishing] = useState(false);

  // ── Suggestion state ───────────────────────────────────────────────────
  const [suggestion, setSuggestion] = useState<SuggestionPayload | null>(null);
  const [refiningMode, setRefiningMode] = useState<EditorialMode | null>(null);
  const [preApplyBody, setPreApplyBody] = useState<string | null>(null);
  const [appliedAiSource, setAppliedAiSource] = useState<{
    operationType: string;
    provider: string;
    model: string;
  } | null>(null);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [isNudging, setIsNudging] = useState(false);
  const [nudgingDirection, setNudgingDirection] =
    useState<NudgeDirection | null>(null);
  const [isTryingAgain, setIsTryingAgain] = useState(false);

  // ── Dirty detection ────────────────────────────────────────────────────
  const isDirty = initialised && (title !== serverTitle || body !== serverBody);
  const { confirmLeave } = useUnsavedChanges(isDirty);

  // ── Sync from server ──────────────────────────────────────────────────
  useEffect(() => {
    if (!post) return;

    if (!initialised) {
      setTitle(post.title);
      setBody(post.body ?? "");
      setServerTitle(post.title);
      setServerBody(post.body ?? "");
      setInitialised(true);
      return;
    }

    if (post.title !== serverTitle || (post.body ?? "") !== serverBody) {
      if (!isDirty) {
        setTitle(post.title);
        setBody(post.body ?? "");
      }
      setServerTitle(post.title);
      setServerBody(post.body ?? "");
    }
  }, [post, initialised, serverTitle, serverBody, isDirty]);

  // ── Handlers (useCallback before early returns) ────────────────────────

  const handleRefine = useCallback(
    async (mode: EditorialMode) => {
      if (!post) return;

      setRefiningMode(mode);
      setError("");

      const actionMap = {
        developmental: refineDevelopmental,
        line: refineLine,
        copy: refineCopy,
      } as const;

      try {
        const result = await actionMap[mode]({ postId: post._id });
        setSuggestion(result);
        setSuggestionIndex((i) => i + 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Refinement failed");
      } finally {
        setRefiningMode(null);
      }
    },
    [post, refineDevelopmental, refineLine, refineCopy]
  );

  const handleNudge = useCallback(
    async (direction: NudgeDirection) => {
      if (!post || !suggestion) return;

      setIsNudging(true);
      setNudgingDirection(direction);
      setError("");

      try {
        await recordNudge({
          orgId: post.orgId,
          postId: post._id,
          editorialMode: suggestion.mode,
          nudgeDirection: direction,
          provider: suggestion.provider,
          model: suggestion.model,
        });

        const result = await refineWithNudge({
          postId: post._id,
          mode: suggestion.mode,
          nudgeDirection: direction,
        });

        setSuggestion({ ...result, nudgeDirection: direction });
        setSuggestionIndex((i) => i + 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Nudge failed");
      } finally {
        setIsNudging(false);
        setNudgingDirection(null);
      }
    },
    [post, suggestion, recordNudge, refineWithNudge]
  );

  const handleTryAgain = useCallback(
    async () => {
      if (!post || !suggestion) return;
      if (!suggestion.runId) return;

      setIsTryingAgain(true);
      setError("");

      try {
        const result = await tryAgainFromRun({ runId: suggestion.runId });
        setSuggestion(result);
        setSuggestionIndex((i) => i + 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Try again failed");
      } finally {
        setIsTryingAgain(false);
      }
    },
    [post, suggestion, tryAgainFromRun]
  );

  const handleRestore = useCallback(
    async (revisionId: Id<"postRevisions">) => {
      if (!post) return;
      if (isDirty && !confirmLeave()) return;

      setError("");
      try {
        await restoreRevision({ postId: post._id, revisionId });
        setPreApplyBody(null);
        setAppliedAiSource(null);
        setSuggestion(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to restore revision"
        );
      }
    },
    [post, isDirty, confirmLeave, restoreRevision]
  );

  // ── Loading / error states (after all hooks) ───────────────────────────
  if (org === undefined || site === undefined || post === undefined) {
    return <p className="text-gray-500 animate-pulse">Loading…</p>;
  }
  if (org === null) {
    return <p className="text-gray-600">Organization not found.</p>;
  }
  if (post === null) {
    return <p className="text-gray-600">Post not found or access denied.</p>;
  }

  const isEditable = post.status === "draft" || post.status === "scheduled";
  const canRefine = isEditable && !isDirty && !suggestion && !refiningMode;

  // ── Remaining handlers ─────────────────────────────────────────────────

  const handleSave = async () => {
    setIsSaving(true);
    setError("");
    try {
      await updatePost({
        postId: post._id,
        title: title.trim(),
        body: body.trim(),
        aiSource: appliedAiSource ?? undefined,
      });
      setServerTitle(title.trim());
      setServerBody(body.trim());
      setPreApplyBody(null);
      setAppliedAiSource(null);
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
      if (isDirty) {
        await updatePost({
          postId: post._id,
          title: title.trim(),
          body: body.trim(),
          aiSource: appliedAiSource ?? undefined,
        });
      }
      await publishPost({ postId: post._id });
      router.push(`/app/${orgSlug}/posts`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish");
      setIsPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    setIsUnpublishing(true);
    setError("");
    try {
      await unpublishPost({ postId: post._id });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to return to draft"
      );
    } finally {
      setIsUnpublishing(false);
    }
  };

  const handleApplySuggestion = () => {
    if (!suggestion) return;
    setPreApplyBody(body);
    setBody(suggestion.suggestedText);
    setAppliedAiSource({
      operationType: suggestion.mode,
      provider: suggestion.provider,
      model: suggestion.model,
    });
    setSuggestion(null);
  };

  const handleRejectSuggestion = () => {
    setSuggestion(null);
  };

  const handleUndoApply = () => {
    if (preApplyBody === null) return;
    setBody(preApplyBody);
    setPreApplyBody(null);
    setAppliedAiSource(null);
  };

  const handleBack = () => {
    if (confirmLeave()) {
      router.push(`/app/${orgSlug}/posts`);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Edit Post</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-gray-500 font-mono">
              /p/{post.slug}
            </span>
            <span
              className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
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
            {isDirty && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">
                unsaved changes
              </span>
            )}
            {preApplyBody !== null && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                suggestion applied
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
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
      </div>

      {/* ── Editor ───────────────────────────────────────────────────── */}
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
            disabled={!isEditable && post.status !== "published"}
          />
        </div>

        {suggestion ? (
          <SuggestionDiff
            mode={suggestion.mode}
            originalText={suggestion.originalText}
            suggestedText={suggestion.suggestedText}
            provider={suggestion.provider}
            model={suggestion.model}
            promptVersion={suggestion.promptVersion}
            orgId={post.orgId}
            postId={post._id}
            suggestionIndex={suggestionIndex}
            nudgeDirection={suggestion.nudgeDirection}
            hasAlternate={suggestion.hasAlternate}
            onApply={handleApplySuggestion}
            onReject={handleRejectSuggestion}
            onNudge={handleNudge}
            onTryAgain={suggestion.runId ? handleTryAgain : undefined}
            isNudging={isNudging}
            isTryingAgain={isTryingAgain}
            nudgingDirection={nudgingDirection}
          />
        ) : (
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
              disabled={!isEditable && post.status !== "published"}
            />
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 p-3 rounded border border-red-100">
            {error}
          </p>
        )}

        {/* ── Primary actions ────────────────────────────────────────── */}
        <div className="flex items-center gap-3 pt-2 flex-wrap">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !isDirty || !title.trim() || !!suggestion}
            className="px-4 py-2 bg-gray-800 text-white rounded-md text-sm font-medium hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>

          {post.status === "draft" && (
            <button
              type="button"
              onClick={handlePublish}
              disabled={isPublishing || !title.trim() || !!suggestion}
              className="px-4 py-2 bg-gray-900 text-white rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isPublishing ? "Publishing…" : "Publish"}
            </button>
          )}

          {post.status === "published" && (
            <button
              type="button"
              onClick={handleUnpublish}
              disabled={isUnpublishing}
              className="px-4 py-2 bg-yellow-600 text-white rounded-md text-sm font-medium hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isUnpublishing ? "Returning…" : "Return to Draft"}
            </button>
          )}

          {preApplyBody !== null && (
            <button
              type="button"
              onClick={handleUndoApply}
              className="px-4 py-2 bg-orange-100 text-orange-700 rounded-md text-sm font-medium hover:bg-orange-200 transition-colors"
            >
              Undo Apply
            </button>
          )}

          <button
            type="button"
            onClick={handleBack}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            Back
          </button>
        </div>

        {/* ── Editorial passes ───────────────────────────────────────── */}
        {isEditable && (
          <div className="border-t border-gray-200 pt-4 mt-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-gray-600">
                Editorial:
              </span>

              {(
                Object.entries(EDITORIAL_MODES) as [
                  EditorialMode,
                  (typeof EDITORIAL_MODES)[EditorialMode],
                ][]
              ).map(([mode, config]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleRefine(mode)}
                  disabled={!canRefine}
                  title={
                    isDirty
                      ? "Save your changes before running editorial passes"
                      : config.description
                  }
                  className="px-3 py-1.5 bg-gray-100 text-gray-800 border border-gray-300 rounded-md text-sm font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {refiningMode === mode
                    ? `Running ${config.label}…`
                    : config.label}
                </button>
              ))}
            </div>

            {isDirty && !suggestion && (
              <p className="text-xs text-gray-400 mt-2">
                Save your changes before running editorial passes.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Voice preferences scratchpad ─────────────────────────────── */}
      {isEditable && <VoiceScratchpad orgId={post.orgId} />}

      {/* ── Revision history ─────────────────────────────────────────── */}
      {revisions && revisions.length > 0 && (
        <div className="mt-10 border-t border-gray-200 pt-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Revision History
          </h2>
          <div className="space-y-2">
            {revisions.map((rev) => {
              const isActive = rev._id === post.activeRevisionId;

              return (
                <div
                  key={rev._id}
                  className={`flex items-start gap-3 text-sm p-3 rounded-md border ${
                    isActive
                      ? "bg-blue-50 border-blue-200"
                      : "bg-gray-50 border-gray-100"
                  }`}
                >
                  <span
                    className={`shrink-0 mt-0.5 px-2 py-0.5 rounded text-xs font-medium ${
                      rev.source === "ai"
                        ? "bg-purple-100 text-purple-700"
                        : rev.source === "initial"
                          ? "bg-blue-100 text-blue-700"
                          : rev.source === "restore"
                            ? "bg-orange-100 text-orange-700"
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
                      {isActive && (
                        <span className="ml-2 text-blue-600 font-medium">
                          active
                        </span>
                      )}
                    </p>
                  </div>
                  {!isActive && isEditable && (
                    <button
                      type="button"
                      onClick={() => handleRestore(rev._id)}
                      className="shrink-0 text-xs text-gray-500 hover:text-gray-700 hover:underline"
                    >
                      Restore
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
```

---

### app/(app)/layout.tsx

```tsx
"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { UserMenu } from "./components/UserMenu";
import { OrgSwitcher } from "./components/OrgSwitcher";
import { OnboardingRecovery } from "./components/OnboardingRecovery";
import { RestartOnboardingButton } from "./components/RestartOnboardingButton";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const userInfo = useQuery(api.users.whoami);
  const orgSlug = params.orgSlug as string | undefined;

  const onboardingStatus = userInfo?.onboardingStatus ?? "not_started";

  useEffect(() => {
    if (!userInfo) return;
    if (onboardingStatus === "not_started") {
      router.replace("/start");
    }
  }, [userInfo, onboardingStatus, router]);

  if (userInfo && onboardingStatus === "not_started") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500 animate-pulse">Redirecting…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <OnboardingRecovery />
      <RestartOnboardingButton />
      <header className="border-b border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/app" className="font-semibold">
              Penrose
            </Link>
            <OrgSwitcher />
          </div>
          <nav className="flex gap-4 items-center">
            {orgSlug ? (
              <>
                <Link
                  href={`/app/${orgSlug}`}
                  className="text-sm hover:underline"
                >
                  Dashboard
                </Link>
                <Link
                  href={`/app/${orgSlug}/posts`}
                  className="text-sm hover:underline"
                >
                  Posts
                </Link>
              </>
            ) : null}
            <div className="ml-2 pl-4 border-l border-gray-200">
              <UserMenu />
            </div>
          </nav>
        </div>
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}
```

---

### lib/useUnsavedChanges.ts

```ts
"use client";

import { useEffect, useCallback } from "react";

/**
 * Guard against accidental data loss when the editor has unsaved changes.
 *
 * - Registers a `beforeunload` handler that triggers the browser's native
 *   "Leave site?" dialog on tab close, refresh, or external navigation.
 *
 * - Returns a `confirmLeave` helper that components can call before
 *   in-app navigation (e.g., the Back button) to show a confirm dialog.
 *
 * Modern browsers ignore custom `beforeunload` messages for security
 * reasons, but still show a generic prompt when `e.preventDefault()`
 * is called.
 */
export function useUnsavedChanges(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const confirmLeave = useCallback((): boolean => {
    if (!isDirty) return true;
    return window.confirm(
      "You have unsaved changes. Are you sure you want to leave?"
    );
  }, [isDirty]);

  return { confirmLeave };
}
```

---

### lib/useOrgBySlug.ts

```ts
"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Resolve an organization by its URL slug via Convex query.
 *
 * Returns:
 *   undefined — query is loading
 *   null     — no org with that slug exists
 *   Doc      — the resolved org document
 *
 * This three-state return leverages Convex's useQuery convention
 * and gives TypeScript clean narrowing in components.
 */
export function useOrgBySlug(slug: string) {
  return useQuery(api.orgs.getBySlug, { slug });
}
```

---

### lib/urls.ts

```ts
/**
 * Build the public URL for a post on a tenant site.
 *
 * @param subdomain - The site subdomain (e.g., "acme")
 * @param postSlug - The post slug (e.g., "my-first-post")
 * @returns The full URL (e.g., "https://acme.penrosepages.com/p/my-first-post")
 * @throws Error if subdomain or postSlug is empty
 *
 * Uses NEXT_PUBLIC_ROOT_DOMAIN (e.g. "penrosepages.com") in production
 * and falls back to "localhost:3000" in local development.
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
```

---

## 2) Refinement trigger plumbing (frontend only)

Refinement is triggered from the edit page via the Editorial buttons (Developmental, Line, Copy) and `handleRefine`. No separate refinement component; no debounce, throttle, or cancellation logic.

---

## 3) Suggestion presentation + apply/undo

### app/(app)/app/[orgSlug]/posts/[postId]/edit/components/SuggestionDiff.tsx

```tsx
"use client";

import { EDITORIAL_MODES, EditorialMode } from "@/convex/lib/prompts";
import { Id } from "@/convex/_generated/dataModel";
import { ReactionPanel } from "./ReactionPanel";
import { NudgeBar } from "./NudgeBar";
import { NudgeDirection } from "@/convex/lib/nudges";

type SuggestionDiffProps = {
  mode: EditorialMode;
  originalText: string;
  suggestedText: string;
  provider: string;
  model: string;
  promptVersion: string;
  orgId: Id<"orgs">;
  postId: Id<"posts">;
  suggestionIndex: number;
  nudgeDirection?: string;
  hasAlternate?: boolean;
  onApply: () => void;
  onReject: () => void;
  onNudge: (direction: NudgeDirection) => void;
  onTryAgain?: () => void;
  isNudging: boolean;
  isTryingAgain?: boolean;
  nudgingDirection: NudgeDirection | null;
};

export function SuggestionDiff({
  mode,
  originalText,
  suggestedText,
  provider,
  model,
  promptVersion,
  orgId,
  postId,
  suggestionIndex,
  nudgeDirection,
  hasAlternate,
  onApply,
  onReject,
  onNudge,
  onTryAgain,
  isNudging,
  isTryingAgain,
  nudgingDirection,
}: SuggestionDiffProps) {
  const modeConfig = EDITORIAL_MODES[mode];

  return (
    <div className="space-y-0">
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="bg-gray-50 px-4 py-3 flex items-center justify-between border-b border-gray-200">
          <div>
            <span className="text-sm font-semibold text-gray-800">
              {modeConfig.label} Edit Suggestion
            </span>
            <span className="ml-2 text-xs text-gray-500">
              {modeConfig.description}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onApply}
              disabled={isNudging}
              className="px-3 py-1.5 bg-gray-900 text-white rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={isNudging}
              className="px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              Reject
            </button>
          </div>
        </div>

        {/* ── Two-column comparison ────────────────────────────────── */}
        <div className="grid grid-cols-2 divide-x divide-gray-200">
          <div className="p-4">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
              Current
            </p>
            <div className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-gray-700">
              {originalText}
            </div>
          </div>

          <div className="p-4 bg-gray-50/50">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
              Suggested
            </p>
            <div className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-gray-800">
              {suggestedText}
            </div>
          </div>
        </div>

        {/* ── Try again (swap) + Nudge bar ──────────────────────────── */}
        <div className="border-t border-gray-100 px-3 py-2 flex flex-wrap items-center gap-3">
          {onTryAgain && hasAlternate && (
            <button
              type="button"
              onClick={onTryAgain}
              disabled={isNudging || isTryingAgain}
              className="px-2.5 py-1 text-xs rounded-full border border-gray-300 text-gray-700 hover:bg-gray-100 hover:border-gray-400 disabled:opacity-50 transition-colors"
            >
              {isTryingAgain ? "…" : "Try again"}
            </button>
          )}
          <NudgeBar
            onNudge={onNudge}
            isRunning={isNudging || (isTryingAgain ?? false)}
            runningDirection={nudgingDirection}
          />
        </div>
      </div>

      {/* ── Reaction panel (outside card, non-blocking) ────────────── */}
      <ReactionPanel
        orgId={orgId}
        postId={postId}
        mode={mode}
        provider={provider}
        model={model}
        promptVersion={promptVersion}
        nudgeDirection={nudgeDirection}
        suggestionIndex={suggestionIndex}
      />
    </div>
  );
}
```

---

### app/(app)/app/[orgSlug]/posts/[postId]/edit/components/NudgeBar.tsx

```tsx
"use client";

import {
  NUDGE_DIRECTIONS,
  NudgeDirection,
  NUDGE_DIRECTION_KEYS,
} from "@/convex/lib/nudges";

type NudgeBarProps = {
  onNudge: (direction: NudgeDirection) => void;
  isRunning: boolean;
  runningDirection: NudgeDirection | null;
};

export function NudgeBar({
  onNudge,
  isRunning,
  runningDirection,
}: NudgeBarProps) {
  return (
    <div className="flex items-center gap-2 py-2 px-1 flex-wrap">
      <span className="text-xs text-gray-500 shrink-0">Try again:</span>
      {NUDGE_DIRECTION_KEYS.map((dir) => (
        <button
          key={dir}
          type="button"
          onClick={() => onNudge(dir)}
          disabled={isRunning}
          className="px-2.5 py-1 text-xs rounded-full border border-gray-300 text-gray-700 hover:bg-gray-100 hover:border-gray-400 disabled:opacity-50 transition-colors"
        >
          {runningDirection === dir ? "…" : NUDGE_DIRECTIONS[dir].label}
        </button>
      ))}
    </div>
  );
}
```

---

### app/(app)/app/[orgSlug]/posts/[postId]/edit/components/ReactionPanel.tsx

```tsx
"use client";

import { useState, useCallback, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { EditorialMode } from "@/convex/lib/prompts";
import {
  PanelType,
  REACTION_PANELS,
  getNextPanel,
} from "@/convex/lib/reactionPanels";

type ReactionPanelProps = {
  orgId: Id<"orgs">;
  postId: Id<"posts">;
  mode: EditorialMode;
  provider: string;
  model: string;
  promptVersion: string;
  nudgeDirection?: string;
  suggestionIndex: number;
};

export function ReactionPanel({
  orgId,
  postId,
  mode,
  provider,
  model,
  promptVersion,
  nudgeDirection,
  suggestionIndex,
}: ReactionPanelProps) {
  const reactionCount = useQuery(api.voiceReactions.getReactionCount, { orgId });
  const submitReaction = useMutation(api.voiceReactions.submitReaction);

  const [answered, setAnswered] = useState<PanelType[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset when a new suggestion arrives
  useEffect(() => {
    setAnswered([]);
  }, [suggestionIndex]);

  const handleReact = useCallback(
    async (panelType: PanelType, reaction: string) => {
      setIsSubmitting(true);
      try {
        await submitReaction({
          orgId,
          postId,
          editorialMode: mode,
          panelType,
          reaction,
          provider,
          model,
          promptVersion,
          nudgeDirection,
        });
        setAnswered((prev) => [...prev, panelType]);
      } finally {
        setIsSubmitting(false);
      }
    },
    [orgId, postId, mode, provider, model, promptVersion, nudgeDirection, submitReaction]
  );

  if (reactionCount === undefined) return null;

  const currentPanel = getNextPanel(reactionCount, answered, suggestionIndex);
  if (!currentPanel) return null;

  const config = REACTION_PANELS[currentPanel];

  return (
    <div className="flex items-center gap-3 py-2 px-1">
      <span className="text-xs text-gray-500 shrink-0">{config.prompt}</span>
      <div className="flex gap-1.5 flex-wrap">
        {config.options.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => handleReact(currentPanel, opt.key)}
            disabled={isSubmitting}
            className="px-2.5 py-1 text-xs rounded-full border border-gray-200 text-gray-600 hover:bg-gray-100 hover:border-gray-300 disabled:opacity-50 transition-colors"
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

---

### app/(app)/app/[orgSlug]/posts/[postId]/edit/components/VoiceScratchpad.tsx

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

type VoiceScratchpadProps = {
  orgId: Id<"orgs">;
};

export function VoiceScratchpad({ orgId }: VoiceScratchpadProps) {
  const pref = useQuery(api.voicePreferences.getForOrg, { orgId });
  const saveScratchpad = useMutation(api.voicePreferences.saveScratchpad);
  const validateScratchpad = useAction(api.voiceActions.validateScratchpad);

  const [content, setContent] = useState("");
  const [serverContent, setServerContent] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState("");

  const isDirty = content !== serverContent;

  useEffect(() => {
    if (!pref) return;
    if (serverContent === "" && pref.content) {
      setContent(pref.content);
      setServerContent(pref.content);
      return;
    }
    if (!isDirty && pref.content !== serverContent) {
      setContent(pref.content);
      setServerContent(pref.content);
    }
  }, [pref, serverContent, isDirty]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError("");
    try {
      await saveScratchpad({ orgId, content: content.trim() });
      setServerContent(content.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }, [orgId, content, saveScratchpad]);

  const handleValidate = useCallback(async () => {
    if (isDirty) {
      setError("Save your changes before validating.");
      return;
    }
    setIsValidating(true);
    setError("");
    try {
      await validateScratchpad({ orgId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setIsValidating(false);
    }
  }, [orgId, isDirty, validateScratchpad]);

  const validation = pref?.validationResult;
  const hasIssues =
    validation &&
    (validation.redundancies.length > 0 ||
      validation.contradictions.length > 0 ||
      validation.suggestions.length > 0);

  return (
    <div className="border-t border-gray-200 pt-4 mt-6">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900"
      >
        <span className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>
          ▸
        </span>
        Voice Preferences
        {pref?.content && (
          <span className="text-xs font-normal text-gray-400 ml-1">
            ({pref.content.length} chars)
          </span>
        )}
      </button>

      {isOpen && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-gray-500">
            Describe your writing style preferences. These guide editorial
            suggestions across all posts.
          </p>

          <textarea
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="e.g., I prefer short sentences. I never use semicolons. I write casually with contractions. Avoid corporate jargon…"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md font-mono focus:ring-gray-500 focus:border-gray-500"
          />

          {error && (
            <p className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-100">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !isDirty}
              className="px-3 py-1.5 bg-gray-800 text-white text-xs rounded hover:bg-gray-900 disabled:opacity-50"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={handleValidate}
              disabled={isValidating || isDirty || !content.trim()}
              className="px-3 py-1.5 bg-gray-200 text-gray-800 border border-gray-300 text-xs rounded hover:bg-gray-300 disabled:opacity-50"
            >
              {isValidating ? "Checking…" : "Check for issues"}
            </button>
          </div>

          {hasIssues && validation && (
            <div className="space-y-2 p-3 bg-gray-50 border border-gray-200 rounded text-xs">
              {validation.contradictions.length > 0 && (
                <div>
                  <p className="font-semibold text-red-600 mb-1">
                    Contradictions
                  </p>
                  {validation.contradictions.map((c, i) => (
                    <p key={i} className="text-red-600 ml-2">
                      • {c}
                    </p>
                  ))}
                </div>
              )}
              {validation.redundancies.length > 0 && (
                <div>
                  <p className="font-semibold text-yellow-600 mb-1">
                    Redundancies
                  </p>
                  {validation.redundancies.map((r, i) => (
                    <p key={i} className="text-yellow-600 ml-2">
                      • {r}
                    </p>
                  ))}
                </div>
              )}
              {validation.suggestions.length > 0 && (
                <div>
                  <p className="font-semibold text-gray-600 mb-1">
                    Suggestions
                  </p>
                  {validation.suggestions.map((s, i) => (
                    <p key={i} className="text-gray-600 ml-2">
                      • {s}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {validation && !hasIssues && (
            <p className="text-xs text-green-600">
              ✓ No contradictions or redundancy detected.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
```

---

**Apply/reject/undo:** Implemented in the edit page (`handleApplySuggestion`, `handleRejectSuggestion`, `handleUndoApply`).

**Keyboard shortcuts:** None currently in the editor.

---

## 4) Minimal Convex client wiring

### app/ConvexClientProvider.tsx

```tsx
/**
 * ⚠️ AUTH FILE - ConvexAuthNextjsProvider. DO NOT MODIFY WITHOUT ASKING USER FIRST.
 */
"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { ReactNode, useMemo } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL environment variable is not set");
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  // Create the client inside the component to ensure it's initialized with auth context
  // Enable verbose logging in development to debug auth token issues
  const convex = useMemo(
    () =>
      new ConvexReactClient(convexUrl!, {
        verbose: process.env.NODE_ENV === "development",
      }),
    []
  );

  return (
    <ConvexAuthNextjsProvider client={convex}>
      {children}
    </ConvexAuthNextjsProvider>
  );
}
```

---

### convex/_generated/api.d.ts

```ts
/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as ai from "../ai.js";
import type * as auth from "../auth.js";
import type * as editorialRuns from "../editorialRuns.js";
import type * as http from "../http.js";
import type * as lib_aiClient from "../lib/aiClient.js";
import type * as lib_candidateSelection from "../lib/candidateSelection.js";
import type * as lib_candidateVariations from "../lib/candidateVariations.js";
import type * as lib_embeddings from "../lib/embeddings.js";
import type * as lib_nudges from "../lib/nudges.js";
import type * as lib_profileConfidence from "../lib/profileConfidence.js";
import type * as lib_prompts from "../lib/prompts.js";
import type * as lib_reactionPanels from "../lib/reactionPanels.js";
import type * as lib_slugify from "../lib/slugify.js";
import type * as lib_voiceCorrection from "../lib/voiceCorrection.js";
import type * as lib_voiceEnforcement from "../lib/voiceEnforcement.js";
import type * as lib_voiceExplainability from "../lib/voiceExplainability.js";
import type * as lib_voiceFingerprint from "../lib/voiceFingerprint.js";
import type * as lib_voiceScoring from "../lib/voiceScoring.js";
import type * as lib_voiceThresholds from "../lib/voiceThresholds.js";
import type * as lib_voiceTypes from "../lib/voiceTypes.js";
import type * as multiCandidate from "../multiCandidate.js";
import type * as onboarding from "../onboarding.js";
import type * as orgs from "../orgs.js";
import type * as postRevisions from "../postRevisions.js";
import type * as posts from "../posts.js";
import type * as sites from "../sites.js";
import type * as testEnv from "../testEnv.js";
import type * as users from "../users.js";
import type * as voiceActions from "../voiceActions.js";
import type * as voiceAnalytics from "../voiceAnalytics.js";
import type * as voiceCalibration from "../voiceCalibration.js";
import type * as voiceEngine from "../voiceEngine.js";
import type * as voiceEvaluations from "../voiceEvaluations.js";
import type * as voicePreferences from "../voicePreferences.js";
import type * as voiceProfiles from "../voiceProfiles.js";
import type * as voiceReactions from "../voiceReactions.js";
import type * as voiceRunExplainability from "../voiceRunExplainability.js";
import type * as voiceRunMetrics from "../voiceRunMetrics.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  ai: typeof ai;
  auth: typeof auth;
  editorialRuns: typeof editorialRuns;
  http: typeof http;
  "lib/aiClient": typeof lib_aiClient;
  "lib/candidateSelection": typeof lib_candidateSelection;
  "lib/candidateVariations": typeof lib_candidateVariations;
  "lib/embeddings": typeof lib_embeddings;
  "lib/nudges": typeof lib_nudges;
  "lib/profileConfidence": typeof lib_profileConfidence;
  "lib/prompts": typeof lib_prompts;
  "lib/reactionPanels": typeof lib_reactionPanels;
  "lib/slugify": typeof lib_slugify;
  "lib/voiceCorrection": typeof lib_voiceCorrection;
  "lib/voiceEnforcement": typeof lib_voiceEnforcement;
  "lib/voiceExplainability": typeof lib_voiceExplainability;
  "lib/voiceFingerprint": typeof lib_voiceFingerprint;
  "lib/voiceScoring": typeof lib_voiceScoring;
  "lib/voiceThresholds": typeof lib_voiceThresholds;
  "lib/voiceTypes": typeof lib_voiceTypes;
  multiCandidate: typeof multiCandidate;
  onboarding: typeof onboarding;
  orgs: typeof orgs;
  postRevisions: typeof postRevisions;
  posts: typeof posts;
  sites: typeof sites;
  testEnv: typeof testEnv;
  users: typeof users;
  voiceActions: typeof voiceActions;
  voiceAnalytics: typeof voiceAnalytics;
  voiceCalibration: typeof voiceCalibration;
  voiceEngine: typeof voiceEngine;
  voiceEvaluations: typeof voiceEvaluations;
  voicePreferences: typeof voicePreferences;
  voiceProfiles: typeof voiceProfiles;
  voiceReactions: typeof voiceReactions;
  voiceRunExplainability: typeof voiceRunExplainability;
  voiceRunMetrics: typeof voiceRunMetrics;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
```

---

### convex/lib/prompts.ts

```ts
/**
 * Editorial mode definitions and prompt augmentation helpers.
 *
 * Each mode has a distinct editorial lens with strict transformation
 * boundaries enforced at the prompt level.
 *
 * Model configuration (temperature, etc.) lives alongside the prompt so
 * that tuning a mode is a single-file change with zero structural impact.
 */

export type EditorialMode = "developmental" | "line" | "copy";

export type EditorialModeConfig = {
  label: string;
  description: string;
  systemPrompt: string;
  modelConfig: {
    temperature: number;
  };
};

export const EDITORIAL_MODES: Record<EditorialMode, EditorialModeConfig> = {
  developmental: {
    label: "Developmental",
    description: "Structure, argument, coherence, content gaps",
    modelConfig: { temperature: 0.6 },
    systemPrompt: `You are a developmental editor. Your job is structural editing ONLY.

WHAT YOU MUST DO:
- Evaluate the overall structure: does the piece have a clear beginning, middle, and end?
- Strengthen the logical progression of the argument from paragraph to paragraph.
- Identify and close content gaps — places where the reader needs more context, evidence, or transition to follow the argument.
- Reorganize paragraphs or sections if the current order weakens coherence.
- Flag sections that are redundant at the structural level (entire paragraphs that repeat the same point).
- Ensure the introduction sets up what the piece delivers and the conclusion resolves what the introduction promised.

WHAT YOU MUST NOT DO:
- Do NOT change the author's voice, tone, personality, humor, or level of formality.
- Do NOT rewrite individual sentences for style, rhythm, or word choice — that is line editing.
- Do NOT correct grammar, spelling, or punctuation — that is copy editing.
- Do NOT introduce ideas, opinions, or arguments the author did not make.
- Do NOT change the meaning of any claim or soften/strengthen the author's stated positions.
- Do NOT alter vocabulary level, slang usage, or idiomatic expressions.

VOICE PRESERVATION RULE:
Read the first three paragraphs carefully. Note the sentence length patterns, vocabulary level, use of contractions, level of formality, and any distinctive stylistic habits (rhetorical questions, direct address, humor, etc.). Every paragraph you write or rewrite must match these patterns. If the author writes short punchy sentences, you write short punchy sentences. If the author is academic and formal, you are academic and formal.

OUTPUT:
Return the full improved text. No commentary. No explanations. No markup. No notes like "I changed X because Y." Just the text.`,
  },
  line: {
    label: "Line",
    description: "Sentence craft, word choice, rhythm, transitions",
    modelConfig: { temperature: 0.4 },
    systemPrompt: `You are a line editor. Your job is sentence-level refinement ONLY.

WHAT YOU MUST DO:
- Tighten sentences: remove unnecessary words, reduce bloat, eliminate filler phrases ("in order to" → "to", "the fact that" → "that", "it is important to note that" → cut).
- Improve rhythm and cadence: vary sentence length, break up monotonous patterns, ensure paragraphs have natural pacing.
- Strengthen transitions between sentences and between paragraphs so the reader flows through without stumbling.
- Replace weak or vague word choices with precise ones (but only when the original is genuinely imprecise, not merely informal).
- Eliminate redundancy at the sentence level — adjacent sentences that say the same thing in slightly different words.
- Fix awkward phrasing, dangling modifiers, and unclear pronoun references.

WHAT YOU MUST NOT DO:
- Do NOT reorganize paragraphs or move sections around — that is developmental editing.
- Do NOT add new arguments, examples, evidence, or ideas that the author did not include.
- Do NOT remove entire paragraphs or sections.
- Do NOT change the author's argument, thesis, or the substance of any claim.
- Do NOT alter the overall structure or the order in which points are presented.
- Do NOT correct spelling, grammar, or punctuation unless the error is entangled with a phrasing fix — isolated mechanical errors are copy editing.

VOICE PRESERVATION RULE:
Study the author's style before editing. Preserve their level of formality, use of contractions, vocabulary level, humor, and distinctive sentence patterns. If the author writes casually, do not make the prose formal. If the author favors long complex sentences by choice, do not break them all into short ones. Improve the sentences the author wrote; do not replace the author's voice with a generic editorial voice.

OUTPUT:
Return the full improved text. No commentary. No explanations. No markup. No tracked changes. Just the text.`,
  },
  copy: {
    label: "Copy",
    description: "Grammar, spelling, punctuation, consistency",
    modelConfig: { temperature: 0.15 },
    systemPrompt: `You are a copy editor. Your job is mechanical correction ONLY.

WHAT YOU MUST DO:
- Fix all spelling errors and typos.
- Fix grammar errors: subject-verb agreement, verb tense consistency, misplaced modifiers, sentence fragments, run-on sentences.
- Fix punctuation: missing commas, incorrect semicolon usage, apostrophe errors, quotation mark placement.
- Enforce consistency: if the author uses "startup" in paragraph 1 and "start-up" in paragraph 4, pick the one the author uses more and apply it everywhere.
- Enforce parallel construction in lists and series.
- Apply serial (Oxford) comma consistently.
- Capitalize proper nouns. Lowercase common nouns that are incorrectly capitalized.
- If a factual claim looks obviously wrong (a date, a name spelling, a well-known statistic), insert [VERIFY: brief note] inline without changing the text around it.

WHAT YOU MUST NOT DO:
- Do NOT rephrase sentences for style, clarity, or flow — that is line editing.
- Do NOT restructure paragraphs or change their order — that is developmental editing.
- Do NOT change word choice unless the word is genuinely misspelled or grammatically wrong.
- Do NOT remove the author's stylistic choices (sentence fragments used for effect, informal language, slang, intentional rule-breaking).
- Do NOT alter the author's voice, tone, or level of formality in any way.
- Do NOT simplify vocabulary or "improve" phrasing.
- Do NOT add transitional phrases, topic sentences, or conclusions.
- If something looks like a deliberate stylistic choice (starting a sentence with "And" or "But", using a one-word sentence for emphasis), leave it alone.

VOICE PRESERVATION RULE:
Your output should be nearly identical to the input. A reader comparing the two should struggle to find differences beyond corrected typos, fixed grammar, and consistent formatting. If you find yourself rewriting a sentence, stop — you have exceeded your scope.

OUTPUT:
Return the full corrected text. No commentary. No explanations. No markup except [VERIFY: ...] tags for factual red flags. Just the text.`,
  },
} as const;

export const EDITORIAL_MODE_KEYS = Object.keys(EDITORIAL_MODES) as EditorialMode[];

export function augmentPromptWithPreferences(
  basePrompt: string,
  scratchpadContent?: string | null
): string {
  if (!scratchpadContent?.trim()) return basePrompt;
  return `${basePrompt}

AUTHOR'S STATED STYLE PREFERENCES (honor these where applicable — they reflect the author's intentional voice choices):
${scratchpadContent.trim()}`;
}
```

---

### convex/lib/nudges.ts

```ts
/**
 * Directional nudge definitions for the "Try again" variant system.
 *
 * Each nudge is a one-time directional instruction appended to the
 * editorial mode prompt. Nudges are ephemeral — they do not alter
 * the tenant's voice profile. Over time, selection patterns feed
 * into preference signal accumulation.
 */

export type NudgeDirection =
  | "more_minimal"
  | "more_raw"
  | "sharper"
  | "softer"
  | "more_emotional"
  | "more_dry";

export type NudgeConfig = {
  label: string;
  instruction: string;
};

export const NUDGE_DIRECTIONS: Record<NudgeDirection, NudgeConfig> = {
  more_minimal: {
    label: "More minimal",
    instruction:
      "Make the text more minimal and stripped down. Remove more unnecessary words, ornamentation, and decorative language. Favor brevity over explanation.",
  },
  more_raw: {
    label: "More raw",
    instruction:
      "Make the text feel more raw and unpolished. Preserve rough edges, imperfections, and directness that give it authentic character. Resist the urge to smooth everything out.",
  },
  sharper: {
    label: "Sharper",
    instruction:
      "Make the text sharper and more incisive. Strengthen the points, tighten the language, and make claims hit harder. Remove hedging and qualifiers where the author's intent is clear.",
  },
  softer: {
    label: "Softer",
    instruction:
      "Make the text softer and more approachable. Ease aggressive or confrontational language without losing the underlying point. Allow more breathing room between ideas.",
  },
  more_emotional: {
    label: "More emotional",
    instruction:
      "Let more emotion come through in the text. Do not manufacture emotion, but amplify what is already present. Let vulnerability, conviction, or passion show more clearly.",
  },
  more_dry: {
    label: "More dry",
    instruction:
      "Make the text drier and more matter-of-fact. Reduce emotionality, sentimentality, and ornamental language. Favor precision and understatement.",
  },
} as const;

export const NUDGE_DIRECTION_KEYS = Object.keys(
  NUDGE_DIRECTIONS
) as NudgeDirection[];
```

---

### convex/lib/reactionPanels.ts

```ts
/**
 * Reaction panel definitions and cadence logic for voice learning.
 *
 * The system collects behavioral signals by showing short reaction
 * panels after editorial suggestions. The cadence tapers as more
 * signals accumulate — aggressive early, invisible later.
 */

export type PanelType = "quality" | "style" | "voice";

export type ReactionOption = {
  key: string;
  label: string;
};

export type PanelConfig = {
  prompt: string;
  options: ReactionOption[];
};

export const REACTION_PANELS: Record<PanelType, PanelConfig> = {
  quality: {
    prompt: "How was this suggestion?",
    options: [
      { key: "perfect", label: "Perfect" },
      { key: "good", label: "Good" },
      { key: "dont_like", label: "Don't like it" },
    ],
  },
  style: {
    prompt: "Any style concerns?",
    options: [
      { key: "too_polished", label: "Too polished" },
      { key: "too_formal", label: "Too formal" },
      { key: "too_long", label: "Too long" },
      { key: "changed_meaning", label: "Changed meaning" },
      { key: "none", label: "No issues" },
    ],
  },
  voice: {
    prompt: "Does this sound like you?",
    options: [
      { key: "sounds_like_me", label: "Sounds just like me" },
      { key: "partly_me", label: "Partly me" },
      { key: "nothing_like_me", label: "Sounds nothing like me" },
    ],
  },
};

const PANEL_ORDER: PanelType[] = ["quality", "style", "voice"];

/**
 * Determine which panel(s) to show given the total reaction count
 * and how many panels have been answered for the current suggestion.
 *
 * Cadence rules:
 *   < 10 total reactions  → show all 3 panels in rotating order
 *   10–24 total           → voice panel only
 *   ≥ 25 total            → voice panel every 5th suggestion
 */
export function getNextPanel(
  totalReactions: number,
  answeredInSession: PanelType[],
  suggestionIndex: number
): PanelType | null {
  if (totalReactions < 10) {
    const offset = totalReactions % PANEL_ORDER.length;
    const rotated = [
      ...PANEL_ORDER.slice(offset),
      ...PANEL_ORDER.slice(0, offset),
    ];
    const next = rotated.find((p) => !answeredInSession.includes(p));
    return next ?? null;
  }

  if (totalReactions < 25) {
    return answeredInSession.includes("voice") ? null : "voice";
  }

  if (suggestionIndex % 5 === 0) {
    return answeredInSession.includes("voice") ? null : "voice";
  }

  return null;
}
```
