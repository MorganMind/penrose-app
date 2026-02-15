## B3.4 — Real-Time Engine Integration (Extraction for Voice-Constrained Micro-Suggestions)

### Identified Entry Points

- **B3 getSuggestion wiring:** `components/editor/extensions/ghostText.ts`, `app/(app)/app/[orgSlug]/posts/[postId]/edit/page.tsx`
- **B3 suggestion server boundary:** `convex/ai.ts` (refineLine), `convex/multiCandidate.ts` (generate)
- **Voice profile/confidence loader:** `convex/voiceProfiles.ts` (getProfileInternal), `convex/voiceEngine.ts` (evaluate)
- **Multi-variant generator + scorer + selector:** `convex/multiCandidate.ts`, `convex/lib/candidateSelection.ts`, `convex/lib/candidateVariations.ts`
- **Enforcement ladder/thresholds:** `convex/lib/voiceEnforcement.ts`, `convex/lib/voiceThresholds.ts`, `convex/lib/profileConfidence.ts`
- **Logging/telemetry:** `convex/voiceRunMetrics.ts` (recordRunMetrics), `convex/voicePreferenceSignals.ts` (recordPreferenceSignals)

---

### components/editor/extensions/ghostText.ts

Why relevant: Ghost text extension; defines `getSuggestion` callback and `SuggestionContext`; decides when suggestions are requested (sentence end, pause); scope sent is `textBefore`, `blockText`, `fullText`.

```typescript
"use client";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Ghost Text Extension for Real-Time Writing Suggestions
 *
 * Core principles:
 * - NEVER interrupt typing flow
 * - Suggestions are visually subordinate (40% opacity, italic, lighter weight)
 * - Single suggestion in active writing zone
 * - Zero layout shift
 * - Disciplined triggers only
 *
 * Interactions:
 * - Tab: Accept full suggestion
 * - Right Arrow: Accept next word
 * - Escape: Dismiss suggestion (200ms fade)
 * - Click ghost text or hint: Accept full suggestion
 * - Click elsewhere: Dismiss suggestion (200ms fade)
 * - Typing: Dismiss instantly and continue
 */

export interface GhostTextOptions {
  /** Callback to fetch suggestion text. Returns null to clear. */
  getSuggestion?: (context: SuggestionContext) => Promise<string | null>;
  /** Pause duration before triggering (ms). Default: 900 */
  pauseDelay?: number;
  /** Whether suggestions are enabled. Default: true */
  enabled?: boolean;
}

export interface SuggestionContext {
  /** Text before cursor in current block */
  textBefore: string;
  /** Full document text */
  fullText: string;
  /** Cursor position */
  cursorPos: number;
  /** Current block/paragraph text */
  blockText: string;
}

/**
 * Loading indicator phase. Transitions driven by two discrete timeouts:
 *   hidden → (100ms) → icon → (500ms) → shimmer
 * At most 2 dispatches, never polling.
 */
type LoadingPhase = "hidden" | "icon" | "shimmer";

interface GhostTextState {
  ghostText: string | null;
  ghostPos: number | null;
  isLoading: boolean;
  loadingPhase: LoadingPhase;
  loadingPos: number | null;
  requestId: number;
  /** Block-scoped cache for backspace restoration */
  cache: {
    /** Block-level text before cursor when suggestion was generated */
    textBefore: string;
    suggestion: string;
    pos: number;
  } | null;
  isFadingOut: boolean;
  acceptedRange: { from: number; to: number } | null;
}

const ghostTextPluginKey = new PluginKey<GhostTextState>("ghostText");

// Sentence-ending punctuation
const SENTENCE_END = /[.!?]\s*$/;

// Extract next word (including leading whitespace) from remaining ghost text
const NEXT_WORD = /^(\s*\S+)/;

/** Data attributes for click target detection in handleClick */
const GHOST_WRAPPER_ATTR = "data-ghost-wrapper";

/**
 * True mid-word detection: cursor is BETWEEN word characters.
 * "hel|lo" → true (both sides are \w)
 * "hello|"  → false (nothing after cursor)
 * "hello| world" → false (space after cursor)
 * "hello |world" → false (space before cursor)
 */
function isCursorMidWord(textBefore: string, textAfter: string): boolean {
  if (textBefore.length === 0 || textAfter.length === 0) return false;
  return (
    /\w/.test(textBefore[textBefore.length - 1]) &&
    /\w/.test(textAfter[0])
  );
}

function getNextWord(text: string): string | null {
  const match = text.match(NEXT_WORD);
  return match ? match[1] : null;
}

export const GhostText = Extension.create<GhostTextOptions>({
  name: "ghostText",

  addOptions() {
    return {
      getSuggestion: undefined,
      pauseDelay: 900,
      enabled: true,
    };
  },

  addProseMirrorPlugins() {
    const extension = this;
    let pauseTimer: ReturnType<typeof setTimeout> | null = null;
    let currentRequestId = 0;
    let fadeOutTimer: ReturnType<typeof setTimeout> | null = null;
    let highlightTimer: ReturnType<typeof setTimeout> | null = null;
    // Two discrete timers for loading phase escalation (not polling)
    let phaseIconTimer: ReturnType<typeof setTimeout> | null = null;
    let phaseShimmerTimer: ReturnType<typeof setTimeout> | null = null;

    const clearPhaseTimers = () => {
      if (phaseIconTimer) { clearTimeout(phaseIconTimer); phaseIconTimer = null; }
      if (phaseShimmerTimer) { clearTimeout(phaseShimmerTimer); phaseShimmerTimer = null; }
    };

    const clearAllTimers = () => {
      if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null; }
      if (fadeOutTimer) { clearTimeout(fadeOutTimer); fadeOutTimer = null; }
      if (highlightTimer) { clearTimeout(highlightTimer); highlightTimer = null; }
      clearPhaseTimers();
    };

    /**
     * Increment request ID and clean up all associated timers.
     * Every path that invalidates the current request MUST call this
     * so phase timers never dispatch for a stale request.
     */
    const cancelCurrentRequest = () => {
      currentRequestId++;
      clearAllTimers();
    };

    /**
     * Start loading phase escalation timers.
     * At 100ms: hidden → icon. At 500ms: icon → shimmer.
     * Guards check requestId so stale timers are no-ops.
     */
    const startPhaseTimers = (
      view: { state: any; dispatch: any },
      requestId: number
    ) => {
      clearPhaseTimers();

      phaseIconTimer = setTimeout(() => {
        phaseIconTimer = null;
        const s = ghostTextPluginKey.getState(view.state);
        if (s?.requestId === requestId && s.isLoading && s.loadingPhase === "hidden") {
          view.dispatch(view.state.tr.setMeta(ghostTextPluginKey, { loadingPhase: "icon" }));
        }
      }, 100);

      phaseShimmerTimer = setTimeout(() => {
        phaseShimmerTimer = null;
        const s = ghostTextPluginKey.getState(view.state);
        if (s?.requestId === requestId && s.isLoading && s.loadingPhase === "icon") {
          view.dispatch(view.state.tr.setMeta(ghostTextPluginKey, { loadingPhase: "shimmer" }));
        }
      }, 500);
    };

    /**
     * Accept text into the document.
     * Uses tr.insertText() which integrates with ProseMirror's history plugin —
     * Cmd+Z naturally reverses it.
     */
    const acceptText = (
      view: { state: any; dispatch: any },
      text: string,
      pos: number,
      remainingGhostText: string | null
    ) => {
      const { state } = view;

      // Compute block-scoped textBefore for cache (must match the compare
      // in apply() which uses $pos.parent.textContent.slice(0, offset))
      const $pos = state.doc.resolve(pos);
      const offsetInBlock = pos - $pos.start();
      const blockTextBefore = $pos.parent.textContent.slice(0, offsetInBlock);

      const tr = state.tr.insertText(text, pos);
      const insertEnd = pos + text.length;

      // Phase timers are irrelevant after acceptance — clear them
      clearPhaseTimers();

      tr.setMeta(ghostTextPluginKey, {
        ghostText: remainingGhostText,
        ghostPos: remainingGhostText ? insertEnd : null,
        isLoading: false,
        loadingPhase: "hidden",
        loadingPos: null,
        isFadingOut: false,
        acceptedRange: { from: pos, to: insertEnd },
        cache: remainingGhostText
          ? {
              textBefore: blockTextBefore + text,
              suggestion: remainingGhostText,
              pos: insertEnd,
            }
          : null,
      });

      view.dispatch(tr);

      // Clear highlight after pulse animation
      if (highlightTimer) clearTimeout(highlightTimer);
      highlightTimer = setTimeout(() => {
        highlightTimer = null;
        const s = ghostTextPluginKey.getState(view.state);
        if (s?.acceptedRange) {
          view.dispatch(
            view.state.tr.setMeta(ghostTextPluginKey, { acceptedRange: null })
          );
        }
      }, 500);
    };

    /**
     * Dismiss ghost text with a 200ms CSS fade-out.
     * @param clearCache If true, also clears the backspace-restore cache.
     */
    const dismissWithFade = (
      view: { state: any; dispatch: any },
      clearCache: boolean
    ) => {
      const s = ghostTextPluginKey.getState(view.state);
      if (!s?.ghostText || s.isFadingOut) return;

      // Start CSS fade
      view.dispatch(
        view.state.tr.setMeta(ghostTextPluginKey, { isFadingOut: true })
      );

      // Remove DOM element after animation completes
      if (fadeOutTimer) clearTimeout(fadeOutTimer);
      fadeOutTimer = setTimeout(() => {
        fadeOutTimer = null;
        const current = ghostTextPluginKey.getState(view.state);
        view.dispatch(
          view.state.tr.setMeta(ghostTextPluginKey, {
            ghostText: null,
            ghostPos: null,
            isFadingOut: false,
            cache: clearCache ? null : (current?.cache ?? null),
          })
        );
      }, 200);
    };

    return [
      new Plugin<GhostTextState>({
        key: ghostTextPluginKey,

        state: {
          init(): GhostTextState {
            return {
              ghostText: null,
              ghostPos: null,
              isLoading: false,
              loadingPhase: "hidden",
              loadingPos: null,
              requestId: 0,
              cache: null,
              isFadingOut: false,
              acceptedRange: null,
            };
          },

          apply(tr, prev): GhostTextState {
            // Meta is a partial patch — merge onto previous state
            const meta = tr.getMeta(ghostTextPluginKey);
            if (meta) {
              return { ...prev, ...meta };
            }

            if (!tr.docChanged) return prev;

            // ── Document changed (typing, undo, paste, etc.) ──

            const next: GhostTextState = { ...prev };

            // Clear ghost text immediately (no fade when typing through)
            if (prev.ghostText !== null && !prev.isFadingOut) {
              next.ghostText = null;
              next.ghostPos = null;
            }

            // Cancel loading
            if (prev.isLoading) {
              next.isLoading = false;
              next.loadingPhase = "hidden";
              next.loadingPos = null;
            }

            // Cancel in-progress fade (remove immediately)
            if (prev.isFadingOut) {
              next.isFadingOut = false;
              next.ghostText = null;
              next.ghostPos = null;
            }

            // Map accepted highlight through document changes
            if (prev.acceptedRange) {
              const from = tr.mapping.map(prev.acceptedRange.from);
              const to = tr.mapping.map(prev.acceptedRange.to);
              // If range was affected by the change, clear it
              if (from !== prev.acceptedRange.from || to !== prev.acceptedRange.to) {
                next.acceptedRange = null;
              } else {
                next.acceptedRange = prev.acceptedRange;
              }
            }

            // Backspace cache restoration: if block-level textBefore matches
            // cache, restore the ghost suggestion instantly
            if (prev.cache && tr.selection) {
              const $pos = tr.doc.resolve(tr.selection.from);
              const offset = tr.selection.from - $pos.start();
              const textBefore = $pos.parent.textContent.slice(0, offset);

              if (textBefore === prev.cache.textBefore) {
                next.ghostText = prev.cache.suggestion;
                next.ghostPos = tr.selection.from;
                next.isFadingOut = false;
              }
            }

            return next;
          },
        },

        props: {
          decorations(editorState) {
            const s = ghostTextPluginKey.getState(editorState);
            if (!s) return DecorationSet.empty;

            const decorations: Decoration[] = [];

            // ── Accepted text highlight pulse ──
            if (s.acceptedRange) {
              const { from, to } = s.acceptedRange;
              const docSize = editorState.doc.content.size;
              if (from >= 0 && to <= docSize && from < to) {
                decorations.push(
                  Decoration.inline(from, to, {
                    class: "ghost-accepted-highlight",
                  })
                );
              }
            }

            // ── Loading indicator (inline at cursor) ──
            if (s.isLoading && s.loadingPos !== null && s.loadingPhase !== "hidden") {
              const phase = s.loadingPhase;
              decorations.push(
                Decoration.widget(
                  s.loadingPos,
                  () => {
                    const el = document.createElement("span");
                    el.className =
                      phase === "shimmer"
                        ? "ghost-loading ghost-loading-shimmer"
                        : "ghost-loading ghost-loading-icon";
                    el.setAttribute("aria-hidden", "true");
                    el.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/></svg>`;
                    return el;
                  },
                  // Vary key by phase so DOM element is recreated on phase change
                  { side: 1, key: `ghost-loading-${phase}` }
                )
              );
            }

            // ── Ghost text + tab hint ──
            if (s.ghostText && s.ghostPos !== null && !s.isLoading) {
              const ghostText = s.ghostText;
              const isFading = s.isFadingOut;

              decorations.push(
                Decoration.widget(
                  s.ghostPos,
                  () => {
                    const wrapper = document.createElement("span");
                    wrapper.className = `ghost-text-wrapper${isFading ? " ghost-text-fading" : ""}`;
                    wrapper.setAttribute("aria-hidden", "true");
                    wrapper.setAttribute(GHOST_WRAPPER_ATTR, "true");

                    const ghost = document.createElement("span");
                    ghost.className = "ghost-text";
                    ghost.textContent = ghostText;

                    const hint = document.createElement("span");
                    hint.className = "ghost-hint";
                    hint.textContent = "Tab";

                    wrapper.appendChild(ghost);
                    wrapper.appendChild(hint);
                    return wrapper;
                  },
                  // Vary key by fading state so DOM element is recreated
                  // when fade class needs to be applied
                  { side: 1, key: `ghost-text-${isFading ? "fade" : "show"}` }
                )
              );
            }

            return DecorationSet.create(editorState.doc, decorations);
          },

          // ── Keyboard handling ──
          handleKeyDown(view, event) {
            const s = ghostTextPluginKey.getState(view.state);

            // Escape: dismiss with fade
            if (event.key === "Escape" && s?.ghostText && !s.isFadingOut) {
              event.preventDefault();
              dismissWithFade(view, true); // Clear cache on explicit dismiss
              return true;
            }

            // No actionable ghost text → pass through
            if (!s?.ghostText || s.isFadingOut || s.ghostPos === null) {
              return false;
            }

            // Tab: accept full suggestion
            if (event.key === "Tab" && !event.shiftKey) {
              event.preventDefault();
              acceptText(view, s.ghostText, s.ghostPos, null);
              return true;
            }

            // Right Arrow (unmodified): accept next word
            if (
              event.key === "ArrowRight" &&
              !event.shiftKey &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.altKey
            ) {
              const word = getNextWord(s.ghostText);
              if (word) {
                event.preventDefault();
                const rest = s.ghostText.slice(word.length);
                acceptText(view, word, s.ghostPos, rest.length > 0 ? rest : null);
                return true;
              }
            }

            return false;
          },

          // ── Click handling ──
          // Clicks on ghost wrapper (text or hint): accept full suggestion
          // Clicks elsewhere: dismiss with fade (keep cache for backspace)
          handleClick(view, _pos, event) {
            const s = ghostTextPluginKey.getState(view.state);
            if (!s?.ghostText || s.isFadingOut || s.ghostPos === null) {
              return false;
            }

            const target = event.target as HTMLElement | null;

            // Click anywhere on the ghost widget → accept full suggestion
            if (target?.closest?.(`[${GHOST_WRAPPER_ATTR}]`)) {
              event.preventDefault();
              acceptText(view, s.ghostText, s.ghostPos, null);
              return true;
            }

            // Click elsewhere in editor → dismiss with fade (keep cache)
            dismissWithFade(view, false);
            return false;
          },

          /**
           * Prevent clicks on the ghost widget from moving the selection
           * before handleClick fires. handleDOMEvents runs before ProseMirror
           * processes the event.
           */
          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement | null;
              if (target?.closest?.(`[${GHOST_WRAPPER_ATTR}]`)) {
                event.preventDefault();
                return true;
              }
              return false;
            },
          },
        },

        view(editorView) {
          const scheduleCheck = () => {
            if (!extension.options.enabled || !extension.options.getSuggestion) {
              return;
            }

            clearAllTimers();

            pauseTimer = setTimeout(async () => {
              pauseTimer = null;
              const { state } = editorView;
              const { selection, doc } = state;

              // Only trigger from cursor selections (not ranges)
              if (!selection.empty) return;

              const $pos = doc.resolve(selection.from);
              const blockStart = $pos.start();
              const offsetInBlock = selection.from - blockStart;
              const blockText = $pos.parent.textContent ?? "";
              const textBefore = blockText.slice(0, offsetInBlock);
              const textAfter = blockText.slice(offsetInBlock);

              // Block if cursor is truly mid-word (word chars on BOTH sides)
              if (isCursorMidWord(textBefore, textAfter)) {
                return;
              }

              // Trigger conditions: sentence completion OR pause after content
              const isSentenceEnd = SENTENCE_END.test(textBefore);
              const hasContent = textBefore.trim().length > 0;

              if (!isSentenceEnd && !hasContent) {
                return;
              }

              // Cache hit — restore instantly, no fetch
              const pluginState = ghostTextPluginKey.getState(state);
              if (pluginState?.cache?.textBefore === textBefore) {
                editorView.dispatch(
                  state.tr.setMeta(ghostTextPluginKey, {
                    ghostText: pluginState.cache.suggestion,
                    ghostPos: selection.from,
                    isLoading: false,
                    loadingPhase: "hidden",
                    loadingPos: null,
                    isFadingOut: false,
                  })
                );
                return;
              }

              // Begin loading — phase starts hidden, timers escalate
              const requestId = ++currentRequestId;

              editorView.dispatch(
                state.tr.setMeta(ghostTextPluginKey, {
                  isLoading: true,
                  loadingPhase: "hidden",
                  loadingPos: selection.from,
                  requestId,
                  ghostText: null,
                  ghostPos: null,
                  isFadingOut: false,
                })
              );

              startPhaseTimers(editorView, requestId);

              try {
                const context: SuggestionContext = {
                  textBefore,
                  fullText: doc.textContent,
                  cursorPos: selection.from,
                  blockText,
                };

                const suggestion = await extension.options.getSuggestion!(context);

                // Stale request check
                if (currentRequestId !== requestId) return;
                clearPhaseTimers();

                editorView.dispatch(
                  editorView.state.tr.setMeta(ghostTextPluginKey, {
                    ghostText: suggestion ?? null,
                    ghostPos: suggestion ? selection.from : null,
                    isLoading: false,
                    loadingPhase: "hidden",
                    loadingPos: null,
                    isFadingOut: false,
                    cache: suggestion
                      ? { textBefore, suggestion, pos: selection.from }
                      : (pluginState?.cache ?? null),
                  })
                );
              } catch {
                // Suggestions are non-critical — fail silently
                if (currentRequestId !== requestId) return;
                clearPhaseTimers();
                editorView.dispatch(
                  editorView.state.tr.setMeta(ghostTextPluginKey, {
                    isLoading: false,
                    loadingPhase: "hidden",
                    loadingPos: null,
                  })
                );
              }
            }, extension.options.pauseDelay);
          };

          return {
            update(view, prevState) {
              if (
                view.state.doc !== prevState.doc ||
                view.state.selection !== prevState.selection
              ) {
                // Cancel pending fetch if text changed
                if (view.state.doc !== prevState.doc) {
                  cancelCurrentRequest();

                  const pluginState = ghostTextPluginKey.getState(view.state);
                  if (pluginState?.isLoading) {
                    view.dispatch(
                      view.state.tr.setMeta(ghostTextPluginKey, {
                        isLoading: false,
                        loadingPhase: "hidden",
                        loadingPos: null,
                      })
                    );
                  }
                }

                scheduleCheck();
              }
            },

            destroy() {
              clearAllTimers();
            },
          };
        },
      }),
    ];
  },
});

export { ghostTextPluginKey };
```

---

### components/editor/PenroseEditor.tsx

Why relevant: Editor component that receives ghostText options and passes them to createPenroseExtensions; B3.4 wiring flows through here.

```typescript
"use client";

import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import {
  createPenroseExtensions,
  type GhostTextOptions,
  type InlineReplacementOptions,
} from "./extensions";

export type PenroseEditorProps = {
  initialMarkdown?: string;
  onChangeMarkdown?: (markdown: string) => void;
  readonly?: boolean;
  placeholder?: string;
  className?: string;
  /** Real-time ghost text suggestion configuration */
  ghostText?: GhostTextOptions;
  /** Inline word replacement suggestion configuration */
  inlineReplacement?: InlineReplacementOptions;
};

export const PenroseEditor = forwardRef<PenroseEditorRef, PenroseEditorProps>(
  function PenroseEditor(
    {
      initialMarkdown = "",
      onChangeMarkdown,
      readonly = false,
      placeholder,
      className,
      ghostText,
      inlineReplacement,
    },
    ref
  ) {
    const editor = useEditor({
      immediatelyRender: false,
      extensions: createPenroseExtensions({
        placeholder,
        ghostText: ghostText ?? { enabled: false },
        inlineReplacement: inlineReplacement ?? { enabled: false },
      }),
      content: initialMarkdown,
      contentType: "markdown",
      editable: !readonly,
      // ...
    });
    // ...
  }
);
```

---

### components/editor/extensions/index.ts

Why relevant: Exports GhostText, SuggestionContext, createPenroseExtensions; B3.4 types flow through here.

```typescript
"use client";

import { GhostText, type GhostTextOptions } from "./ghostText";
import { InlineReplacement, type InlineReplacementOptions } from "./inlineReplacement";

export type { GhostTextOptions, SuggestionContext } from "./ghostText";

export interface PenroseExtensionOptions {
  placeholder?: string;
  ghostText?: GhostTextOptions;
  inlineReplacement?: InlineReplacementOptions;
}

export function createPenroseExtensions(
  options: PenroseExtensionOptions | string = {}
) {
  const opts = typeof options === "string" ? { placeholder: options } : options;
  const { placeholder, ghostText, inlineReplacement } = opts;

  return [
    // ... StarterKit, Link, Placeholder, Markdown, CleanPaste
    GhostText.configure(ghostText ?? {}),
    InlineReplacement.configure(inlineReplacement ?? {}),
    DiffDecoration,
  ];
}
```

---

### components/editor/mockSuggestionProvider.ts

Why relevant: Placeholder for B3 getSuggestion; replace with voice-constrained Convex action call. Currently returns mock completions; B3.4 will swap to real suggestion API.

```typescript
"use client";

import type { SuggestionContext } from "./extensions";

/**
 * Mock suggestion provider for testing the ghost text UI.
 * Replace with actual AI integration later.
 */

const PLACEHOLDER_COMPLETIONS: Record<string, string[]> = {
  "The ": [
    "quick brown fox jumps over the lazy dog.",
    "sun was setting behind the mountains.",
    "door creaked open slowly.",
  ],
  "I think ": [
    "we should consider this more carefully.",
    "there's a better way to approach this.",
    "the key insight here is simplicity.",
  ],
  "This is ": [
    "exactly what we needed.",
    "a fascinating development.",
    "worth exploring further.",
  ],
};

const SENTENCE_CONTINUATIONS = [
  " However, there's more to consider.",
  " This raises an interesting question.",
  " The implications are significant.",
  " Let me explain further.",
];

/**
 * Simulates suggestion latency for testing UI states
 */
function simulateLatency(): Promise<void> {
  const rand = Math.random();
  let delay: number;

  if (rand < 0.3) {
    delay = 50 + Math.random() * 50;
  } else if (rand < 0.7) {
    delay = 100 + Math.random() * 400;
  } else {
    delay = 500 + Math.random() * 1000;
  }

  return new Promise((resolve) => setTimeout(resolve, delay));
}

export async function getMockSuggestion(
  context: SuggestionContext
): Promise<string | null> {
  const { textBefore } = context;

  await simulateLatency();

  for (const [prefix, completions] of Object.entries(PLACEHOLDER_COMPLETIONS)) {
    if (textBefore.endsWith(prefix)) {
      const completion =
        completions[Math.floor(Math.random() * completions.length)];
      return completion;
    }
  }

  if (/[.!?]\s*$/.test(textBefore) && textBefore.trim().length > 20) {
    return SENTENCE_CONTINUATIONS[
      Math.floor(Math.random() * SENTENCE_CONTINUATIONS.length)
    ];
  }

  if (textBefore.trim().length > 10 && Math.random() < 0.2) {
    return "...";
  }

  return null;
}
```

---

### app/(app)/app/[orgSlug]/posts/[postId]/edit/page.tsx (excerpt: ghost text wiring)

Why relevant: Wires `getSuggestion: getMockSuggestion` into PenroseEditor; B3.4 will replace with Convex action that passes userId, orgId, postId for voice profile + enforcement.

```typescript
// Lines 571-590: PenroseEditor with ghost text config
<PenroseEditor
  ref={editorRef}
  initialMarkdown={body}
  onChangeMarkdown={(md) => {
    setBody(md);
    scheduleSave({ title, body: md });
  }}
  readonly={!isEditable && post.status !== "published"}
  placeholder="Start writing…"
  ghostText={{
    enabled: isEditable,
    getSuggestion: getMockSuggestion,
    pauseDelay: 900,
  }}
  inlineReplacement={{
    enabled: isEditable,
    getReplacementSuggestion: getMockReplacement,
    pauseDelay: 1100,
  }}
/>
```

---

### convex/lib/voiceEnforcement.ts

Why relevant: Defines enforcement tiers (pass/soft_warning/failure/drift), thresholds, and `classify()`; B3.4 uses these to suppress suggestions below threshold (return null).

```typescript
/**
 * Tiered voice enforcement classification and corrective prompt generation.
 *
 * Four deterministic classifications based on explicit numeric thresholds:
 *
 *  1. PASS — all scores above pass thresholds, return as-is
 *  2. SOFT_WARNING — stylistic drift detected but meaning preserved,
 *     regenerate with stricter stylistic constraints
 *  3. FAILURE — combined score below failure floor, regenerate with
 *     overall strict preservation constraints
 *  4. DRIFT — semantic score below drift threshold (meaning changed),
 *     regenerate with strict meaning preservation regardless of
 *     other scores
 *
 * Classification priority: DRIFT > FAILURE > SOFT_WARNING > PASS
 * Drift is checked first because meaning loss is the most critical
 * violation — a suggestion can score well on style and scope but
 * still introduce claims the author never made.
 *
 * Retry budget: exactly 1. A boolean guard prevents re-entry.
 * If retry candidates still fail, the original text is returned.
 */

import type {
  VoiceFingerprint,
  EditorialMode,
} from "./voiceTypes";
import {
  computeThresholdModulation,
  type ThresholdModulation,
} from "./profileConfidence";

// ── Classification types ─────────────────────────────────────────────────

export type EnforcementClass =
  | "pass"
  | "soft_warning"
  | "failure"
  | "drift";

/**
 * Terminal enforcement outcome stored on the run.
 * "original_returned" means all retry candidates failed and the
 * system returned the author's unmodified text.
 */
export type EnforcementOutcome =
  | "pass"
  | "soft_warning_resolved"
  | "failure_resolved"
  | "drift_resolved"
  | "original_returned";

// ── Tiered thresholds ────────────────────────────────────────────────────

/**
 * Each mode defines three boundary layers:
 *
 *  pass:         combined >= passFloor AND semantic >= semanticPassFloor
 *  soft_warning: combined >= warningFloor AND semantic >= semanticWarningFloor
 *  failure:      combined < warningFloor
 *  drift:        semantic < driftCeiling (checked FIRST, overrides others)
 */
type EnforcementThresholds = {
  passFloor: number; // combined score must be >= this for PASS
  semanticPassFloor: number; // semantic must also be >= this for PASS
  warningFloor: number; // combined score >= this = SOFT_WARNING (not FAILURE)
  semanticWarningFloor: number; // semantic >= this within warning band
  driftCeiling: number; // semantic < this = DRIFT regardless of combined
};

const ENFORCEMENT_THRESHOLDS: Record<EditorialMode, EnforcementThresholds> = {
  line: {
    passFloor: 0.78,
    semanticPassFloor: 0.82,
    warningFloor: 0.65,
    semanticWarningFloor: 0.72,
    driftCeiling: 0.70,
  },
  developmental: {
    passFloor: 0.74,
    semanticPassFloor: 0.78,
    warningFloor: 0.58,
    semanticWarningFloor: 0.68,
    driftCeiling: 0.65,
  },
  copy: {
    passFloor: 0.82,
    semanticPassFloor: 0.85,
    warningFloor: 0.68,
    semanticWarningFloor: 0.75,
    driftCeiling: 0.72,
  },
};

export function getEnforcementThresholds(
  mode: EditorialMode
): EnforcementThresholds {
  return ENFORCEMENT_THRESHOLDS[mode];
}

// ── Confidence-aware classification ──────────────────────────────────────

/**
 * Classify a candidate with confidence-aware thresholds.
 *
 * When profileConfidence is provided, thresholds are modulated:
 *  - Low confidence: stylistic thresholds relax, semantic thresholds tighten
 *  - High confidence: base thresholds apply
 *
 * This ensures early profiles (few samples) don't over-enforce
 * stylistic patterns that haven't been confirmed through repetition,
 * while still strictly preserving meaning from the start.
 */
export function classify(
  combinedScore: number,
  semanticScore: number,
  mode: EditorialMode,
  profileConfidence?: number | null
): EnforcementClass {
  const base = ENFORCEMENT_THRESHOLDS[mode];

  let passFloor = base.passFloor;
  let semanticPassFloor = base.semanticPassFloor;
  let warningFloor = base.warningFloor;
  let semanticWarningFloor = base.semanticWarningFloor;
  let driftCeiling = base.driftCeiling;

  if (profileConfidence != null) {
    const mod = computeThresholdModulation(profileConfidence);

    // Stylistic-sensitive thresholds relax at low confidence
    passFloor = base.passFloor * mod.stylisticRelaxation;
    warningFloor = base.warningFloor * mod.stylisticWarningRelaxation;

    // Semantic-sensitive thresholds tighten at low confidence
    semanticPassFloor = Math.min(
      0.98,
      base.semanticPassFloor * mod.semanticTightening
    );
    semanticWarningFloor = Math.min(
      0.98,
      base.semanticWarningFloor * mod.semanticTightening
    );
    driftCeiling = Math.min(
      0.95,
      base.driftCeiling * mod.driftSensitivity
    );
  }

  // Priority 1: Drift
  if (semanticScore < driftCeiling) {
    return "drift";
  }

  // Priority 2: Pass
  if (combinedScore >= passFloor && semanticScore >= semanticPassFloor) {
    return "pass";
  }

  // Priority 3: Failure
  if (combinedScore < warningFloor) {
    return "failure";
  }

  // Priority 4: Soft warning
  return "soft_warning";
}

export function requiresEnforcement(ec: EnforcementClass): boolean {
  return ec !== "pass";
}
```

---

### convex/lib/profileConfidence.ts

Why relevant: Computes profile confidence (0–1); B3.4 uses low confidence to reduce stylistic aggressiveness and `computeThresholdModulation()` for enforcement.

```typescript
/**
 * Profile confidence model (Phase 13.5 Part 2 — Cold-Start Confidence Scaling).
 *
 * Confidence is a composite score (0–1) answering:
 * "How reliably does this profile represent the author's true voice?"
 *
 * Before confidence crosses the threshold (low < 0.4, high ≥ 0.7):
 * - Relax stylistic enforcement slightly
 * - Prioritize semantic preservation
 * As confidence increases: tighten stylistic similarity penalties,
 * reduce tolerance for cadence drift.
 */

export type ConfidenceComponents = {
  wordConfidence: number;
  sampleConfidence: number;
  diversityScore: number;
  temporalSpread: number;
};

export type ConfidenceBand = "low" | "medium" | "high";

export type ProfileConfidence = {
  overall: number;
  components: ConfidenceComponents;
  band: ConfidenceBand;
};

const LOW_CEILING = 0.4;
const HIGH_FLOOR = 0.7;

export function classifyBand(confidence: number): ConfidenceBand {
  if (confidence < LOW_CEILING) return "low";
  if (confidence >= HIGH_FLOOR) return "high";
  return "medium";
}

export function computeConfidence(
  totalWordCount: number,
  sampleCount: number,
  diversity: DiversityInputs,
  oldestSampleAt: number,
  newestSampleAt: number
): ProfileConfidence {
  // ... (full implementation in file)
  return { overall, components, band: classifyBand(overall) };
}

export type ThresholdModulation = {
  stylisticRelaxation: number;
  semanticTightening: number;
  stylisticWarningRelaxation: number;
  driftSensitivity: number;
};

/**
 * Low confidence: stylistic thresholds at 75% of base, semantic at 108%
 * High confidence: all at 100% of base
 * Medium: linear interpolation
 */
export function computeThresholdModulation(
  confidence: number
): ThresholdModulation {
  const t = Math.max(
    0,
    Math.min(1, (confidence - LOW_CEILING) / (HIGH_FLOOR - LOW_CEILING))
  );
  const effective = confidence < LOW_CEILING ? 0 : t;

  return {
    stylisticRelaxation: lerp(0.75, 1.0, effective),
    semanticTightening: lerp(1.08, 1.0, effective),
    stylisticWarningRelaxation: lerp(0.80, 1.0, effective),
    driftSensitivity: lerp(1.06, 1.0, effective),
  };
}

export function computeFeatureSensitivity(confidence: number): number {
  const t = Math.max(
    0,
    Math.min(1, (confidence - LOW_CEILING) / (HIGH_FLOOR - LOW_CEILING))
  );
  const effective = confidence < LOW_CEILING ? 0 : t;
  return lerp(0.60, 1.0, effective);
}
```

---

### convex/lib/voiceThresholds.ts

Why relevant: Defines pass/fail thresholds per mode; B3.4 uses these for similarity-threshold suppression (below threshold → return null).

```typescript
/**
 * Voice safety thresholds per editorial mode.
 */

import type { VoiceThresholds, EditorialMode } from "./voiceTypes";

export const MIN_SAMPLES_FOR_ENFORCEMENT = 3;

const THRESHOLDS: Record<EditorialMode, VoiceThresholds> = {
  copy: {
    semantic: 0.8,
    stylistic: 0.65,
    scope: 0.7,
    combined: 0.72,
  },
  line: {
    semantic: 0.75,
    stylistic: 0.6,
    scope: 0.6,
    combined: 0.68,
  },
  developmental: {
    semantic: 0.7,
    stylistic: 0.55,
    scope: 0.5,
    combined: 0.62,
  },
};

export function getThresholds(mode: EditorialMode): VoiceThresholds {
  return THRESHOLDS[mode];
}

export function passesThresholds(
  scores: {
    semanticScore: number;
    stylisticScore: number;
    scopeScore: number;
    combinedScore: number;
  },
  thresholds: VoiceThresholds
): boolean {
  return (
    scores.semanticScore >= thresholds.semantic &&
    scores.stylisticScore >= thresholds.stylistic &&
    scores.scopeScore >= thresholds.scope &&
    scores.combinedScore >= thresholds.combined
  );
}
```

---

### convex/voiceEngine.ts

Why relevant: Loads voice profile + confidence, runs evaluation; B3.4 suggestion action will call evaluate (or a lightweight variant) for micro-suggestions.

```typescript
"use node";

/**
 * Voice Identity Engine — the main orchestration action.
 * Called by ai.ts for every editorial refinement.
 */

export type VoiceEvaluationOutput = EvaluationResult & {
  evaluationId: Id<"voiceEvaluations"> | null;
  scores: { semanticScore, stylisticScore, scopeScore, combinedScore };
  profileConfidence: number | null;
  profileConfidenceBand: string | null;
};

export const evaluate = internalAction({
  args: {
    userId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
    postId: v.optional(v.id("posts")),
    originalText: v.string(),
    suggestedText: v.string(),
    editorialMode: v.union(v.literal("developmental"), v.literal("line"), v.literal("copy")),
    provider: v.string(),
    model: v.string(),
    promptVersion: v.string(),
  },
  handler: async (ctx, args): Promise<VoiceEvaluationOutput> => {
    const profile = await ctx.runQuery(internal.voiceProfiles.getProfileInternal, { userId: args.userId, orgId: args.orgId });
    const profileConfidence = profile ? (profile.confidence ?? null) : null;
    // ... scoring, thresholds, recordEvaluation
    return { scores, profileConfidence, profileConfidenceBand, ... };
  },
});
```

---

### convex/voiceProfiles.ts (getProfileInternal)

Why relevant: Returns voice profile + fingerprint + confidence for user/org; B3.4 suggestion action needs this to apply voice constraints.

```typescript
export const getProfileInternal = internalQuery({
  args: {
    userId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
  },
  handler: async (ctx, { userId, orgId }) => {
    if (orgId) {
      const orgProfile = await ctx.db
        .query("voiceProfiles")
        .withIndex("by_org_and_user", (q) => q.eq("orgId", orgId).eq("userId", userId))
        .first();
      if (orgProfile) return orgProfile;
    }
    return await ctx.db
      .query("voiceProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("orgId"), undefined))
      .first();
  },
});
```

---

### convex/multiCandidate.ts (excerpt: generate flow)

Why relevant: Multi-variant generation, scoring, enforcement classification, winner selection; B3.4 will adapt this for sentence/paragraph-scoped micro-suggestions (fewer candidates, lower latency).

```typescript
export const generate = internalAction({
  args: {
    userId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
    postId: v.optional(v.id("posts")),
    originalText: v.string(),
    editorialMode: v.union(v.literal("developmental"), v.literal("line")),
    variationSeed: v.number(),
    nudgeDirection: v.optional(v.string()),
    scratchpadContent: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<MultiCandidateResult> => {
    // PHASE 1: Generate 2 candidates, evaluate each
    // PHASE 2: Classify best with profileConfidence-aware thresholds
    // PHASE 3: If requiresEnforcement → one retry with enforcement prompts
    // PHASE 4: Select winner (passing or highest scorer)
    // PHASE 5: If all fail → returnedOriginal = true
    // PHASE 6: Persist run + candidates + voiceRunMetrics
    return result;
  },
});
```

---

### convex/lib/candidateSelection.ts

Why relevant: `computeSelectionScore()` ranks candidates; B3.4 uses same logic to pick winner from micro-suggestion pool.

```typescript
const SELECTION_WEIGHTS = {
  stylistic: 0.45,
  semantic: 0.35,
  scope: 0.2,
};

export function computeSelectionScore(scores: CandidateScores): number {
  return (
    scores.stylisticScore * SELECTION_WEIGHTS.stylistic +
    scores.semanticScore * SELECTION_WEIGHTS.semantic +
    scores.scopeScore * SELECTION_WEIGHTS.scope
  );
}
```

---

### convex/lib/voiceScoring.ts (excerpt)

Why relevant: `computeStylisticScore`, `computeScopeScore`, `semanticHeuristicPenalty`, `computeCombinedScore`; all confidence-aware; B3.4 uses these for scoring micro-suggestions.

```typescript
export function computeStylisticScore(
  suggestion: VoiceFingerprint,
  profile: VoiceFingerprint,
  profileConfidence?: number | null
): number { /* confidence-aware dampening */ }

export function computeScopeScore(original, suggestion, mode): number { /* ... */ }

export function semanticHeuristicPenalty(original: string, suggestion: string): number { /* ... */ }

export function computeCombinedScore(
  scores: Omit<VoiceScores, "combinedScore">,
  mode: EditorialMode,
  profileConfidence?: number | null
): number { /* confidence-aware weight modulation */ }
```

---

### convex/ai.ts (refineLine entry point)

Why relevant: Public action for line refinement; B3.4 will add a new `getMicroSuggestion` (or similar) action that reuses multiCandidate/voiceEngine logic for sentence/paragraph scope.

```typescript
export const refineLine = action({
  args: refineArgs,
  handler: async (ctx, args) =>
    runMultiCandidateRefinement(ctx, args, "line"),
});
```

---

### convex/lib/voiceTypes.ts

Why relevant: `VoiceFingerprint`, `VoiceScores`, `EditorialMode`, `VoiceThresholds`; shared types for scoring and enforcement.

```typescript
export type VoiceFingerprint = {
  avgSentenceLength: number;
  sentenceLengthStdDev: number;
  punctuationFrequencies: PunctuationFrequencies;
  hedgingFrequency: number;
  contractionFrequency: number;
  // ... etc
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  confidence: number;
};

export type VoiceScores = {
  semanticScore: number;
  stylisticScore: number;
  scopeScore: number;
  combinedScore: number;
};

export type EditorialMode = "developmental" | "line" | "copy";
```

---

### convex/lib/prompts.ts (EDITORIAL_MODES line)

Why relevant: Line mode system prompt; B3.4 micro-suggestion prompt will be derived from line mode, scoped to sentence/paragraph.

```typescript
line: {
  label: "Line",
  description: "Sentence craft, word choice, rhythm, transitions",
  modelConfig: { temperature: 0.4 },
  systemPrompt: `You are a line editor. Your job is sentence-level refinement ONLY.
... VOICE PRESERVATION RULE: Study the author's style before editing. ...
OUTPUT: Return the full improved text. No commentary.`,
},
```

---

### convex/lib/candidateVariations.ts

Why relevant: `getVariationPair()` produces prompt variations for multi-candidate; B3.4 may use a reduced set for micro-suggestions.

```typescript
export function getVariationPair(
  mode: "developmental" | "line",
  seed: number
): VariationPair {
  const pairs = VARIATION_MAP[mode];
  const index = seed % pairs.length;
  return pairs[index];
}
```

---

### convex/voiceRunMetrics.ts (recordRunMetrics)

Why relevant: Logs run metadata (model, promptVersion, scores, enforcementClass); B3.4 can extend for B3 acceptance/rejection/suppression telemetry.

```typescript
// Called from multiCandidate.generate after persisting run
await ctx.runMutation(internal.voiceRunMetrics.recordRunMetrics, {
  runId,
  userId,
  orgId,
  editorialMode,
  provider,
  model,
  promptVersion,
  semanticScore,
  stylisticScore,
  combinedScore,
  profileConfidence,
  enforcementClass,
});
```

---

### convex/voicePreferenceSignals.ts (recordPreferenceSignals)

Why relevant: Records apply/reject signals; B3.4 ghost text accepts will need to call this (or equivalent) for preference learning when user accepts suggestion.

```typescript
// Called from edit page handleApplySuggestion / handleRejectSuggestion
recordPreferenceSignals({
  orgId,
  postId,
  editorialMode,
  source: "apply" | "reject" | "hunk_apply",
  originalText,
  appliedText,
});
```
