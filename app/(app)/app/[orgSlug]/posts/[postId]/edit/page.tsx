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

  const handleApplySuggestion = (text: string) => {
    if (!suggestion) return;
    setPreApplyBody(body);
    setBody(text);
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
            draftInvalidated={body !== suggestion.originalText}
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
