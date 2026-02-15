# B3 Real-Time Editor — UI/Interaction Extraction (Post-Tiptap)

> Scope: Tiptap editor, extensions, autosave, editor page, CSS, dependencies.
> NOT in scope: Suggestion diff flow, voice engine, scoring, enforcement, backend pipelines.
> Generated 2026-02-14. Reference only.

---


## 1. Tiptap Editor Core

### `components/editor/PenroseEditor.tsx`

```tsx
"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { createPenroseExtensions } from "./extensions";

export type PenroseEditorRef = {
  getMarkdown: () => string;
  setContent: (markdown: string) => void;
  focus: () => void;
};

export type PenroseEditorProps = {
  initialMarkdown?: string;
  onChangeMarkdown?: (markdown: string) => void;
  readonly?: boolean;
  placeholder?: string;
  className?: string;
};

export const PenroseEditor = forwardRef<PenroseEditorRef, PenroseEditorProps>(
  function PenroseEditor(
    { initialMarkdown = "", onChangeMarkdown, readonly = false, placeholder, className },
    ref
  ) {
    const onChangeRef = useRef(onChangeMarkdown);
    onChangeRef.current = onChangeMarkdown;

    const editor = useEditor({
      immediatelyRender: false,
      extensions: createPenroseExtensions(placeholder),
      content: initialMarkdown,
      contentType: "markdown",
      editable: !readonly,
      editorProps: {
        attributes: {
          class:
            "prose-editor min-h-[200px] outline-none focus:outline-none",
        },
      },
      onUpdate: ({ editor }) => {
        if (editor.isDestroyed) return;
        const md = editor.getMarkdown?.();
        if (typeof md === "string") {
          onChangeRef.current?.(md);
        }
      },
    });

    useEffect(() => {
      if (!editor) return;
      editor.setEditable(!readonly);
    }, [editor, readonly]);

    useImperativeHandle(
      ref,
      () => ({
        getMarkdown: () => {
          if (!editor) return "";
          return editor.getMarkdown?.() ?? "";
        },
        setContent: (markdown: string) => {
          if (!editor) return;
          editor.commands.setContent(markdown ?? "", {
            contentType: "markdown",
            emitUpdate: false,
          });
        },
        focus: () => editor?.commands.focus(),
      }),
      [editor]
    );

    if (!editor) return null;

    return (
      <div className={className}>
        <EditorContent editor={editor} />
      </div>
    );
  }
);

```

---

### `components/editor/useAutosave.ts`

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type SavePayload = {
  title: string;
  body: string;
};

export type UseAutosaveOptions = {
  onSave: (payload: SavePayload) => Promise<void>;
  debounceMs?: number;
};

export function useAutosave({
  onSave,
  debounceMs = 600,
}: UseAutosaveOptions) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<SavePayload | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  const save = useCallback(
    async (payload: SavePayload) => {
      if (savingRef.current) {
        pendingRef.current = payload;
        return;
      }
      savingRef.current = true;
      setStatus("saving");
      try {
        await onSave(payload);
        setStatus("saved");
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setStatus("idle"), 2000);
      } catch {
        setStatus("error");
      } finally {
        savingRef.current = false;
        const next = pendingRef.current;
        pendingRef.current = null;
        if (next !== null) {
          save(next);
        }
      }
    },
    [onSave]
  );

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, []);

  const scheduleSave = useCallback(
    (payload: SavePayload) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        save(payload);
      }, debounceMs);
    },
    [save, debounceMs]
  );

  return { status, scheduleSave, save };
}

```

---

### `components/editor/SaveIndicator.tsx`

```tsx
"use client";

import type { SaveStatus } from "./useAutosave";

type SaveIndicatorProps = {
  status: SaveStatus;
  className?: string;
};

export function SaveIndicator({ status, className = "" }: SaveIndicatorProps) {
  if (status === "idle") return null;

  const text =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : status === "error"
          ? "Save failed"
          : "";

  return (
    <span
      className={`text-xs text-gray-400 ${className}`}
      aria-live="polite"
    >
      {text}
    </span>
  );
}

```

---

### `components/editor/index.ts`

```ts
export { PenroseEditor, type PenroseEditorRef, type PenroseEditorProps } from "./PenroseEditor";
export { useAutosave, type SaveStatus, type SavePayload } from "./useAutosave";
export { SaveIndicator } from "./SaveIndicator";

```

---


## 2. Tiptap Extensions

### `components/editor/extensions/index.ts`

```ts
"use client";

import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { CleanPaste } from "./cleanPaste";
import { GhostText } from "./ghostText";
import { InlineReplacement } from "./inlineReplacement";
import { DiffDecoration } from "./diffDecoration";

/**
 * Penrose baseline editor extensions.
 * Minimal but serious set for long-form writing and Markdown publishing.
 */
export function createPenroseExtensions(placeholder?: string) {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3] },
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: "text-gray-700 underline hover:text-gray-900" },
    }),
    Placeholder.configure({ placeholder: placeholder ?? "Start writing…" }),
    Markdown.configure({
      markedOptions: { gfm: true, breaks: true },
    }),
    CleanPaste,
    GhostText,
    InlineReplacement,
    DiffDecoration,
  ];
}

```

---

### `components/editor/extensions/ghostText.ts`

```ts
"use client";

import { Extension } from "@tiptap/core";

/**
 * Placeholder extension for B3 ghost text (inline suggestions).
 * No behavior implemented yet — architecture is extension-first.
 */
export const GhostText = Extension.create({
  name: "ghostText",
});

```

---

### `components/editor/extensions/inlineReplacement.ts`

```ts
"use client";

import { Extension } from "@tiptap/core";

/**
 * Placeholder extension for B3 inline replacement underline.
 * No behavior implemented yet — architecture is extension-first.
 */
export const InlineReplacement = Extension.create({
  name: "inlineReplacement",
});

```

---

### `components/editor/extensions/diffDecoration.ts`

```ts
"use client";

import { Extension } from "@tiptap/core";

/**
 * Placeholder extension for B3 diff decoration overlays.
 * No behavior implemented yet — architecture is extension-first.
 */
export const DiffDecoration = Extension.create({
  name: "diffDecoration",
});

```

---

### `components/editor/extensions/cleanPaste.ts`

```ts
"use client";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Clean paste: strip HTML formatting by default.
 * Hold Shift while pasting to preserve formatting.
 */
export const CleanPaste = Extension.create({
  name: "cleanPaste",

  addProseMirrorPlugins() {

    return [
      new Plugin({
        key: new PluginKey("cleanPaste"),
        props: {
          handlePaste(view, event) {
            const html = event.clipboardData?.getData("text/html");
            const text = event.clipboardData?.getData("text/plain") ?? "";

            // Shift+paste: allow rich paste (default ProseMirror behavior)
            if ("shiftKey" in event && event.shiftKey) return false;

            // No HTML or empty: let default handler run
            if (!html?.trim() || !text?.trim()) return false;

            // HTML present without Shift: paste as plain text
            event.preventDefault();
            const { state, dispatch } = view;
            const { from } = state.selection;
            const tr = state.tr.insertText(text, from);
            dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});

```

---


## 3. Editor Page

### `app/(app)/app/[orgSlug]/posts/[postId]/edit/page.tsx`

```tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
import { RefiningPlaceholder } from "./components/RefiningPlaceholder";
import { PenroseEditor, type PenroseEditorRef } from "@/components/editor/PenroseEditor";
import { useAutosave } from "@/components/editor/useAutosave";
import { SaveIndicator } from "@/components/editor/SaveIndicator";

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
  const recordPreferenceSignals = useMutation(
    api.voicePreferenceSignals.recordPreferenceSignals
  );
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

  // ── A4.3: Stale request cancellation ────────────────────────────────
  const refineRequestId = useRef(0);
  const tryAgainRequestId = useRef(0);
  const nudgeRequestId = useRef(0);

  // ── A4.3: Apply confirmation + auto-dismiss undo ───────────────────
  const [showAppliedConfirm, setShowAppliedConfirm] = useState(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Editor ref (for imperative updates: apply suggestion, undo, restore) ─
  const editorRef = useRef<PenroseEditorRef | null>(null);
  const postRef = useRef<typeof post>(undefined);
  const appliedAiSourceRef = useRef(appliedAiSource);
  postRef.current = post;
  appliedAiSourceRef.current = appliedAiSource;

  // ── Dirty detection ────────────────────────────────────────────────────
  const isDirty = initialised && (title !== serverTitle || body !== serverBody);
  const { confirmLeave } = useUnsavedChanges(isDirty);

  // ── Autosave ───────────────────────────────────────────────────────────
  const { status: autosaveStatus, scheduleSave } = useAutosave({
    onSave: async (payload) => {
      const p = postRef.current;
      if (!p) return;
      await updatePost({
        postId: p._id,
        title: payload.title.trim(),
        body: payload.body,
        aiSource: appliedAiSourceRef.current ?? undefined,
      });
      setServerTitle(payload.title.trim());
      setServerBody(payload.body);
      setPreApplyBody(null);
      setAppliedAiSource(null);
    },
    debounceMs: 600,
  });

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
        editorRef.current?.setContent(post.body ?? "");
      }
      setServerTitle(post.title);
      setServerBody(post.body ?? "");
    }
  }, [post, initialised, serverTitle, serverBody, isDirty]);

  // ── Handlers (useCallback before early returns) ────────────────────────

  const handleRefine = useCallback(
    async (mode: EditorialMode) => {
      if (!post) return;

      // Cancel any stale in-flight refine request
      const thisRequest = ++refineRequestId.current;

      setRefiningMode(mode);
      setError("");

      const actionMap = {
        developmental: refineDevelopmental,
        line: refineLine,
        copy: refineCopy,
      } as const;

      try {
        const result = await actionMap[mode]({ postId: post._id });
        // Only apply if this is still the latest request
        if (thisRequest !== refineRequestId.current) return;
        setSuggestion(result);
        setSuggestionIndex((i) => i + 1);
      } catch (err) {
        if (thisRequest !== refineRequestId.current) return;
        setError(err instanceof Error ? err.message : "Refinement failed");
      } finally {
        if (thisRequest === refineRequestId.current) {
          setRefiningMode(null);
        }
      }
    },
    [post, refineDevelopmental, refineLine, refineCopy]
  );

  const handleNudge = useCallback(
    async (direction: NudgeDirection) => {
      if (!post || !suggestion) return;

      const thisRequest = ++nudgeRequestId.current;

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

        if (thisRequest !== nudgeRequestId.current) return;
        setSuggestion({ ...result, nudgeDirection: direction });
        setSuggestionIndex((i) => i + 1);
      } catch (err) {
        if (thisRequest !== nudgeRequestId.current) return;
        setError(err instanceof Error ? err.message : "Nudge failed");
      } finally {
        if (thisRequest === nudgeRequestId.current) {
          setIsNudging(false);
          setNudgingDirection(null);
        }
      }
    },
    [post, suggestion, recordNudge, refineWithNudge]
  );

  const handleTryAgain = useCallback(
    async () => {
      if (!post || !suggestion) return;
      if (!suggestion.runId) return;

      const thisRequest = ++tryAgainRequestId.current;

      setIsTryingAgain(true);
      setError("");

      try {
        const result = await tryAgainFromRun({ runId: suggestion.runId });
        if (thisRequest !== tryAgainRequestId.current) return;
        setSuggestion(result);
        setSuggestionIndex((i) => i + 1);
      } catch (err) {
        if (thisRequest !== tryAgainRequestId.current) return;
        setError(err instanceof Error ? err.message : "Try again failed");
      } finally {
        if (thisRequest === tryAgainRequestId.current) {
          setIsTryingAgain(false);
        }
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

  const handleApplySuggestion = (text: string, wasPartialApply?: boolean) => {
    if (!suggestion || !post) return;
    // Record preference signal (bounded nudge, does NOT mutate voice profile)
    recordPreferenceSignals({
      orgId: post.orgId,
      postId: post._id,
      editorialMode: suggestion.mode,
      source: wasPartialApply ? "hunk_apply" : "apply",
      originalText: suggestion.originalText,
      appliedText: text,
    }).catch(() => {}); // Non-blocking
    setPreApplyBody(body);
    setBody(text);
    setAppliedAiSource({
      operationType: suggestion.mode,
      provider: suggestion.provider,
      model: suggestion.model,
    });
    setSuggestion(null);

    // A4.3: Show "Applied" confirmation, then fade
    setShowAppliedConfirm(true);
    if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current);
    appliedTimerRef.current = setTimeout(() => setShowAppliedConfirm(false), 2000);

    // A4.3: Auto-dismiss undo after 8 seconds
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => {
      setPreApplyBody(null);
    }, 8000);
  };

  const handleRejectSuggestion = () => {
    if (suggestion && post) {
      // Record reject as negative preference signal
      recordPreferenceSignals({
        orgId: post.orgId,
        postId: post._id,
        editorialMode: suggestion.mode,
        source: "reject",
        originalText: suggestion.originalText,
        appliedText: suggestion.suggestedText,
      }).catch(() => {}); // Non-blocking
    }
    setSuggestion(null);
  };

  const handleUndoApply = () => {
    if (preApplyBody === null) return;
    setBody(preApplyBody);
    editorRef.current?.setContent(preApplyBody);
    setPreApplyBody(null);
    setAppliedAiSource(null);
    setShowAppliedConfirm(false);
    // Clear auto-dismiss timers
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current);
  };

  const handleBack = () => {
    if (confirmLeave()) {
      router.push(`/app/${orgSlug}/posts`);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-[680px] mx-auto">
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
            <SaveIndicator status={autosaveStatus} />
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
        {/* Title: borderless, flows into body */}
        <div>
          <input
            type="text"
            id="title"
            className="w-full text-2xl font-semibold border-0 border-b border-transparent focus:border-gray-300 focus:outline-none focus:ring-0 px-0 py-2 bg-transparent placeholder:text-gray-400"
            placeholder="Title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              scheduleSave({ title: e.target.value, body });
            }}
            disabled={!isEditable && post.status !== "published"}
          />
        </div>

        {/* A4.3: Keep text visible while refining — same card layout as SuggestionDiff */}
        {refiningMode && !suggestion ? (
          <RefiningPlaceholder
            mode={refiningMode}
            bodyText={body}
            onDismiss={() => setRefiningMode(null)}
          />
        ) : suggestion ? (
          <div className="animate-card-enter">
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
          </div>
        ) : initialised ? (
          <div
            className={`border border-gray-200 rounded-lg px-4 py-3 min-h-[280px] ${
              showAppliedConfirm ? "animate-ink-settle" : ""
            }`}
          >
            <PenroseEditor
              ref={editorRef}
              initialMarkdown={body}
              onChangeMarkdown={(md) => {
                setBody(md);
                scheduleSave({ title, body: md });
              }}
              readonly={!isEditable && post.status !== "published"}
              placeholder="Start writing…"
            />
          </div>
        ) : null}

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
            className="btn-micro px-4 py-2 bg-gray-800 text-white rounded-md text-sm font-medium hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>

          {post.status === "draft" && (
            <button
              type="button"
              onClick={handlePublish}
              disabled={isPublishing || !title.trim() || !!suggestion}
              className="btn-micro px-4 py-2 bg-gray-900 text-white rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPublishing ? "Publishing…" : "Publish"}
            </button>
          )}

          {post.status === "published" && (
            <button
              type="button"
              onClick={handleUnpublish}
              disabled={isUnpublishing}
              className="btn-micro px-4 py-2 bg-yellow-600 text-white rounded-md text-sm font-medium hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUnpublishing ? "Returning…" : "Return to Draft"}
            </button>
          )}

          {/* A4.3: "Applied" micro-confirmation — no modal, no toast */}
          {showAppliedConfirm && (
            <span className="animate-applied-fade text-xs text-gray-400">
              Applied
            </span>
          )}

          {/* A4.3: Undo appears instantly, stays 8s, no confirmation needed */}
          {preApplyBody !== null && (
            <button
              type="button"
              onClick={handleUndoApply}
              className="btn-micro px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md"
            >
              Undo
            </button>
          )}

          <button
            type="button"
            onClick={handleBack}
            className="btn-micro px-4 py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200"
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
                  className="btn-micro px-3 py-1.5 bg-gray-100 text-gray-800 border border-gray-300 rounded-md text-sm font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {refiningMode === mode
                    ? `Refining…`
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


## 4. Editor Hooks & Utilities

### `lib/useUnsavedChanges.ts`

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

### `lib/markdown.ts`

```ts
/**
 * Markdown utilities for non-editor contexts (e.g. public post rendering).
 * The Tiptap editor uses @tiptap/markdown for parse/serialize during editing.
 */

import { marked } from "marked";

/**
 * Convert markdown to HTML for display.
 * Used on the public post page where there is no Tiptap editor.
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown?.trim()) return "";
  return marked.parse(markdown, {
    gfm: true,
    breaks: true,
  }) as string;
}

```

---


## 5. CSS & Animations

### `app/globals.css`

```css
@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #171717;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-instrument-sans);
  --font-mono: var(--font-geist-mono);
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
    --foreground: #ededed;
  }
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans), ui-sans-serif, system-ui, sans-serif;
}

/* ── A4.3 Refinement Polish Animations ──────────────────────────────────── */

/* Pen wiggle: slow, minimal rotation fulcrumed on the pen tip */
@keyframes pen-wiggle {
  0%   { transform: rotate(0deg); }
  25%  { transform: rotate(3deg); }
  50%  { transform: rotate(0deg); }
  75%  { transform: rotate(-3deg); }
  100% { transform: rotate(0deg); }
}

/* Skeleton shimmer for placeholder cards */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.animate-shimmer {
  background: linear-gradient(
    90deg,
    #f3f4f6 25%,
    #e5e7eb 37%,
    #f3f4f6 63%
  );
  background-size: 200% 100%;
  animation: shimmer 1.6s ease-in-out infinite;
}

/* Card swap: subtle vertical slide for suggestion transitions */
@keyframes card-enter {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-card-enter {
  animation: card-enter 150ms ease-out forwards;
}

/* Ink settle: gentle opacity sweep for apply confirmation */
@keyframes ink-settle {
  0% { opacity: 0.6; }
  40% { opacity: 1; }
  100% { opacity: 0.85; }
}

.animate-ink-settle {
  animation: ink-settle 600ms ease-out forwards;
}

/* Applied confirmation fade-in then fade-out */
@keyframes applied-fade {
  0% { opacity: 0; }
  15% { opacity: 1; }
  75% { opacity: 1; }
  100% { opacity: 0; }
}

.animate-applied-fade {
  animation: applied-fade 2s ease-out forwards;
}

/* Highlight fade: diff highlights fade to 60% after settling */
@keyframes highlight-fade {
  0% { opacity: 1; }
  100% { opacity: 0.6; }
}

.diff-highlight-fade {
  animation: highlight-fade 400ms ease-out 3s forwards;
}

.diff-highlight-fade:hover {
  opacity: 1 !important;
  transition: opacity 120ms ease-out;
}

/* Trust badge fade-out */
@keyframes trust-badge-fade {
  0%, 70% { opacity: 1; }
  100% { opacity: 0; }
}

.animate-trust-badge {
  animation: trust-badge-fade 5s ease-out forwards;
}

/* Button microinteractions */
.btn-micro {
  transition: transform 120ms ease-out, opacity 120ms ease-out, background-color 120ms ease-out, border-color 120ms ease-out;
}

.btn-micro:hover:not(:disabled) {
  transform: scale(1.02);
}

.btn-micro:active:not(:disabled) {
  transform: scale(0.98);
  opacity: 0.9;
}

/* ── Penrose Editor (Tiptap) ────────────────────────────────────────────── */

.prose-editor {
  line-height: 1.75;
}

.prose-editor p {
  margin-bottom: 0.75em;
}

.prose-editor p:last-child {
  margin-bottom: 0;
}

.prose-editor h1 {
  font-size: 1.75rem;
  font-weight: 600;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  line-height: 1.3;
}

.prose-editor h1:first-child {
  margin-top: 0;
}

.prose-editor h2 {
  font-size: 1.35rem;
  font-weight: 600;
  margin-top: 1.25em;
  margin-bottom: 0.5em;
  line-height: 1.35;
}

.prose-editor h3 {
  font-size: 1.15rem;
  font-weight: 600;
  margin-top: 1em;
  margin-bottom: 0.4em;
  line-height: 1.4;
}

.prose-editor ul,
.prose-editor ol {
  margin: 0.75em 0;
  padding-left: 1.5em;
}

.prose-editor li {
  margin-bottom: 0.25em;
}

.prose-editor blockquote {
  border-left: 3px solid #e5e7eb;
  padding-left: 1em;
  margin: 1em 0;
  color: #4b5563;
}

.prose-editor code {
  font-family: var(--font-mono), ui-monospace, monospace;
  font-size: 0.9em;
  background: #f3f4f6;
  padding: 0.15em 0.35em;
  border-radius: 0.25rem;
}

.prose-editor a {
  color: #374151;
  text-decoration: underline;
}

.prose-editor a:hover {
  color: #111827;
}

.prose-editor hr {
  border: none;
  border-top: 1px solid #e5e7eb;
  margin: 1.5em 0;
}

.prose-editor .tiptap p.is-editor-empty:first-child::before {
  color: #9ca3af;
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}

```

---


## 6. Dependencies

### `package.json`

```json
{
  "name": "penrose-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "convex:dev": "convex dev",
    "calibrate:voice": "npx tsx scripts/voice-calibration/run-calibration.ts",
    "calibrate:voice:dry": "SKIP_EMBEDDINGS=true npx tsx scripts/voice-calibration/run-calibration.ts",
    "validate:multi-variant": "npx tsx scripts/voice-calibration/validate-multi-variant.ts",
    "regression": "npx tsx scripts/voice-calibration/run-regression.ts",
    "regression:baseline": "npx tsx scripts/voice-calibration/run-regression.ts --save-baseline"
  },
  "dependencies": {
    "@auth/core": "^0.37.0",
    "@convex-dev/auth": "^0.0.90",
    "@tiptap/extension-link": "^3.19.0",
    "@tiptap/extension-placeholder": "^3.19.0",
    "@tiptap/markdown": "^3.19.0",
    "@tiptap/pm": "^3.19.0",
    "@tiptap/react": "^3.19.0",
    "@tiptap/starter-kit": "^3.19.0",
    "diff": "^8.0.3",
    "marked": "^17.0.2",
    "next": "16.1.6",
    "next-auth": "^5.0.0-beta.30",
    "react": "19.2.3",
    "react-dom": "19.2.3"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "convex": "^1.31.7",
    "eslint": "^9",
    "eslint-config-next": "16.1.6",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}

```

---

