"use client";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { suggestionMetrics } from "../suggestionMetrics";

/**
 * Inline Replacement Extension
 *
 * B3.5 — Latency Masking:
 * - Throttle: max one replacement per 2 seconds
 * - Hard stale-request cancellation via version counter + hook cancel
 * - Network failures silently swallowed
 *
 * B3.7 — Stability & Edge Case Hardening:
 * - Rapid typing guard: suppresses during fast keystroke bursts
 * - Selection guard: no triggers during range selections
 * - Multi-cursor guard: only acts on primary cursor
 * - Conflicting edit guard: doc changes during fetch invalidate result
 * - Canvas always wins: typing clears suggestions instantly
 * - Internal metrics via suggestionMetrics
 */

export interface InlineReplacementOptions {
  /**
   * Given a word and its surrounding context, return a replacement suggestion
   * or null if no replacement applies.
   */
  getReplacementSuggestion?: (
    context: ReplacementContext
  ) => Promise<ReplacementSuggestion | null>;
  /** Hard-cancel any in-flight replacement request at the hook level. */
  cancelReplacementSuggestion?: () => void;
  /** Pause before scanning for replacements (ms). Default: 1100 */
  pauseDelay?: number;
  /** Minimum gap between displayed replacements (ms). Default: 2000 */
  throttleInterval?: number;
  /** Whether replacement suggestions are enabled. Default: true */
  enabled?: boolean;
}

export interface ReplacementContext {
  /** The word under or near the cursor */
  word: string;
  /** Start position of the word in the document */
  wordFrom: number;
  /** End position of the word in the document */
  wordTo: number;
  /** Text of the full block/paragraph */
  blockText: string;
  /** The sentence containing the word, if detectable */
  sentence: string;
  /** Full document text */
  fullText: string;
}

export interface ReplacementSuggestion {
  /** Original word/phrase to replace */
  original: string;
  /** Suggested replacement */
  replacement: string;
  /** Optional short rationale shown beneath replacement */
  reason?: string;
}

interface InlineReplacementState {
  /** Active suggestion, if any */
  suggestion: {
    original: string;
    replacement: string;
    reason?: string;
    from: number;
    to: number;
  } | null;
  /** Whether a replacement fetch is in progress */
  isLoading: boolean;
  /** Stale-request guard */
  requestId: number;
  /** Whether tooltip is fading out */
  isFadingOut: boolean;
}

const REPLACEMENT_KEY = new PluginKey<InlineReplacementState>(
  "inlineReplacement"
);

/** Data attribute for tooltip click target identification */
const TOOLTIP_ACCEPT_ATTR = "data-replacement-accept";

// ── B3.5/B3.7 Constants ──
/** Minimum characters to count as "rapid typing" within the debounce window */
const RAPID_TYPING_THRESHOLD = 3;
const DEFAULT_THROTTLE_INTERVAL = 2000;

/**
 * Resolve the word at or immediately before the cursor position.
 * Returns null if cursor is mid-word (we only trigger after cursor settles
 * at a word boundary).
 */
function resolveWordNearCursor(
  doc: any,
  pos: number
): { word: string; from: number; to: number; blockText: string; sentence: string } | null {
  let $pos;
  try {
    $pos = doc.resolve(pos);
  } catch {
    return null;
  }

  const parent = $pos.parent;
  if (!parent.isTextblock) return null;

  const blockText = parent.textContent;
  const blockStart = $pos.start();
  const offset = pos - blockStart;

  // Don't trigger if cursor is in the middle of a word
  const charAfter = blockText[offset] ?? "";
  if (/\w/.test(charAfter)) return null;

  // Walk backwards from cursor to find the word that just ended
  let wordEnd = offset;
  let scan = offset - 1;
  while (scan >= 0 && /[\s,;:]/.test(blockText[scan]!)) {
    scan--;
  }
  if (scan < 0) return null;

  wordEnd = scan + 1;
  let wordStart = scan;
  while (wordStart > 0 && /\w/.test(blockText[wordStart - 1]!)) {
    wordStart--;
  }
  if (!/\w/.test(blockText[wordStart]!)) return null;

  const word = blockText.slice(wordStart, wordEnd);
  if (word.length === 0) return null;

  // Extract rough sentence for context
  const sentenceStart = blockText.lastIndexOf(".", wordStart - 1);
  const sentenceEnd = blockText.indexOf(".", wordEnd);
  const sentence = blockText.slice(
    sentenceStart >= 0 ? sentenceStart + 1 : 0,
    sentenceEnd >= 0 ? sentenceEnd + 1 : blockText.length
  ).trim();

  return {
    word,
    from: blockStart + wordStart,
    to: blockStart + wordEnd,
    blockText,
    sentence,
  };
}

export const InlineReplacement = Extension.create<InlineReplacementOptions>({
  name: "inlineReplacement",

  addOptions() {
    return {
      getReplacementSuggestion: undefined,
      cancelReplacementSuggestion: undefined,
      pauseDelay: 1100,
      throttleInterval: DEFAULT_THROTTLE_INTERVAL,
      enabled: true,
    };
  },

  addProseMirrorPlugins() {
    const extension = this;
    let pauseTimer: ReturnType<typeof setTimeout> | null = null;
    let fadeOutTimer: ReturnType<typeof setTimeout> | null = null;
    let currentRequestId = 0;

    // Track recent keystrokes for rapid-typing detection
    let recentEditTimestamps: number[] = [];

    // B3.5: Throttle tracking
    let lastDisplayTime = 0;

    // B3.7: Doc snapshot for conflicting-edit detection
    let docAtRequestStart: any = null;

    const clearTimers = () => {
      if (pauseTimer) {
        clearTimeout(pauseTimer);
        pauseTimer = null;
      }
      if (fadeOutTimer) {
        clearTimeout(fadeOutTimer);
        fadeOutTimer = null;
      }
    };

    const cancelCurrentRequest = () => {
      currentRequestId++;
      docAtRequestStart = null;
      clearTimers();
      extension.options.cancelReplacementSuggestion?.();
    };

    const isRapidTyping = (): boolean => {
      const now = Date.now();
      recentEditTimestamps = recentEditTimestamps.filter(
        (t) => now - t < (extension.options.pauseDelay ?? 1100)
      );
      return recentEditTimestamps.length >= RAPID_TYPING_THRESHOLD;
    };

    const recordKeystroke = () => {
      recentEditTimestamps.push(Date.now());
    };

    /**
     * Accept the replacement. Inserts via tr.insertText for proper undo.
     */
    const acceptReplacement = (view: { state: any; dispatch: any }) => {
      const s = REPLACEMENT_KEY.getState(view.state);
      if (!s?.suggestion) return;

      const { from, to, replacement } = s.suggestion;
      const { state } = view;

      // Validate range is still valid
      if (from < 0 || to > state.doc.content.size || from >= to) return;

      const tr = state.tr.insertText(replacement, from, to);
      tr.setMeta(REPLACEMENT_KEY, {
        suggestion: null,
        isLoading: false,
        isFadingOut: false,
      });
      view.dispatch(tr);

      suggestionMetrics.record("accept", "replacement");
    };

    /**
     * Dismiss with 100ms fade.
     */
    const dismissWithFade = (view: { state: any; dispatch: any }) => {
      const s = REPLACEMENT_KEY.getState(view.state);
      if (!s?.suggestion || s.isFadingOut) return;

      suggestionMetrics.record("reject", "replacement");

      view.dispatch(
        view.state.tr.setMeta(REPLACEMENT_KEY, { isFadingOut: true })
      );

      if (fadeOutTimer) clearTimeout(fadeOutTimer);
      fadeOutTimer = setTimeout(() => {
        fadeOutTimer = null;
        view.dispatch(
          view.state.tr.setMeta(REPLACEMENT_KEY, {
            suggestion: null,
            isFadingOut: false,
          })
        );
      }, 100);
    };

    /**
     * Dismiss immediately, no animation.
     */
    const dismissImmediate = (view: { state: any; dispatch: any }) => {
      const s = REPLACEMENT_KEY.getState(view.state);
      if (!s?.suggestion && !s?.isLoading) return;

      if (fadeOutTimer) {
        clearTimeout(fadeOutTimer);
        fadeOutTimer = null;
      }

      view.dispatch(
        view.state.tr.setMeta(REPLACEMENT_KEY, {
          suggestion: null,
          isLoading: false,
          isFadingOut: false,
        })
      );
    };

    return [
      new Plugin<InlineReplacementState>({
        key: REPLACEMENT_KEY,

        state: {
          init(): InlineReplacementState {
            return {
              suggestion: null,
              isLoading: false,
              requestId: 0,
              isFadingOut: false,
            };
          },

          apply(tr, prev): InlineReplacementState {
            const meta = tr.getMeta(REPLACEMENT_KEY);
            if (meta) {
              return { ...prev, ...meta };
            }

            if (!tr.docChanged) return prev;

            // Text changed → canvas wins, invalidate immediately
            const next: InlineReplacementState = { ...prev };

            if (prev.suggestion) {
              next.suggestion = null;
              next.isFadingOut = false;
            }
            if (prev.isLoading) {
              next.isLoading = false;
            }

            return next;
          },
        },

        props: {
          decorations(editorState) {
            const s = REPLACEMENT_KEY.getState(editorState);
            if (!s?.suggestion) return DecorationSet.empty;

            const { from, to, replacement, reason } = s.suggestion;
            const decorations: Decoration[] = [];

            // Validate range
            if (from < 0 || to > editorState.doc.content.size || from >= to) {
              return DecorationSet.empty;
            }

            // Underline on the target word
            decorations.push(
              Decoration.inline(from, to, {
                class: `replacement-underline${s.isFadingOut ? " replacement-fading" : ""}`,
              })
            );

            // Tooltip positioned at the start of the word
            decorations.push(
              Decoration.widget(from, () => {
                const tooltip = document.createElement("span");
                tooltip.className = `replacement-tooltip${s.isFadingOut ? " replacement-tooltip-fading" : ""}`;
                tooltip.setAttribute("aria-hidden", "true");

                const text = document.createElement("span");
                text.className = "replacement-tooltip-text";
                text.textContent = replacement;
                text.setAttribute(TOOLTIP_ACCEPT_ATTR, "true");

                tooltip.appendChild(text);

                if (reason) {
                  const reasonEl = document.createElement("span");
                  reasonEl.className = "replacement-tooltip-reason";
                  reasonEl.textContent = reason;
                  tooltip.appendChild(reasonEl);
                }

                return tooltip;
              }, {
                side: -1,
                key: "replacement-tooltip",
              })
            );

            return DecorationSet.create(editorState.doc, decorations);
          },

          handleKeyDown(view, event) {
            const s = REPLACEMENT_KEY.getState(view.state);
            if (!s?.suggestion || s.isFadingOut) return false;

            // Escape → dismiss
            if (event.key === "Escape") {
              event.preventDefault();
              dismissWithFade(view);
              return true;
            }

            return false;
          },

          handleClick(view, _pos, event) {
            const s = REPLACEMENT_KEY.getState(view.state);
            if (!s?.suggestion || s.isFadingOut) return false;

            const target = event.target as HTMLElement | null;

            if (target?.closest?.(`[${TOOLTIP_ACCEPT_ATTR}]`)) {
              event.preventDefault();
              acceptReplacement(view);
              return true;
            }

            dismissWithFade(view);
            return false;
          },

          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement | null;
              if (target?.closest?.(`[${TOOLTIP_ACCEPT_ATTR}]`)) {
                event.preventDefault();
                return true;
              }
              return false;
            },
          },
        },

        view(editorView) {
          const scheduleCheck = () => {
            if (
              !extension.options.enabled ||
              !extension.options.getReplacementSuggestion
            ) {
              return;
            }

            clearTimers();

            pauseTimer = setTimeout(async () => {
              pauseTimer = null;

              const { state } = editorView;
              const { selection, doc } = state;

              // ── B3.7: Selection guard ──
              if (!selection.empty) {
                suggestionMetrics.record("selection_skip", "replacement");
                return;
              }

              // ── B3.7: Multi-cursor guard — primary cursor only ──
              if (
                "ranges" in selection &&
                Array.isArray((selection as any).ranges) &&
                (selection as any).ranges.length > 1
              ) {
                return;
              }

              // ── B3.7: Rapid typing guard ──
              if (isRapidTyping()) {
                suggestionMetrics.record("rapid_typing_skip", "replacement");
                return;
              }

              // ── Guard: ghost text is loading (don't stack indicators) ──
              try {
                const ghostKey = new PluginKey("ghostText");
                const ghostState = ghostKey.getState(state);
                if (ghostState?.isLoading) return;
              } catch {
                // Ghost text plugin may not exist — continue
              }

              // ── B3.5: Throttle check ──
              const now = Date.now();
              const throttleInterval =
                extension.options.throttleInterval ?? DEFAULT_THROTTLE_INTERVAL;
              if (now - lastDisplayTime < throttleInterval) {
                suggestionMetrics.record("throttle_skip", "replacement");
                return;
              }

              // ── Resolve word near cursor ──
              const wordInfo = resolveWordNearCursor(doc, selection.from);
              if (!wordInfo) return;

              const requestId = ++currentRequestId;
              docAtRequestStart = doc;

              editorView.dispatch(
                state.tr.setMeta(REPLACEMENT_KEY, {
                  isLoading: true,
                  requestId,
                })
              );

              try {
                const suggestion =
                  await extension.options.getReplacementSuggestion!({
                    word: wordInfo.word,
                    wordFrom: wordInfo.from,
                    wordTo: wordInfo.to,
                    blockText: wordInfo.blockText,
                    sentence: wordInfo.sentence,
                    fullText: doc.textContent,
                  });

                // Stale check
                if (currentRequestId !== requestId) {
                  suggestionMetrics.record("stale_discard", "replacement");
                  return;
                }

                // ── B3.7: Conflicting edit check ──
                if (editorView.state.doc !== docAtRequestStart) {
                  suggestionMetrics.record("conflict_skip", "replacement");
                  cancelCurrentRequest();
                  return;
                }

                if (suggestion) {
                  lastDisplayTime = Date.now();

                  editorView.dispatch(
                    editorView.state.tr.setMeta(REPLACEMENT_KEY, {
                      suggestion: {
                        original: suggestion.original,
                        replacement: suggestion.replacement,
                        reason: suggestion.reason,
                        from: wordInfo.from,
                        to: wordInfo.to,
                      },
                      isLoading: false,
                      isFadingOut: false,
                    })
                  );
                } else {
                  editorView.dispatch(
                    editorView.state.tr.setMeta(REPLACEMENT_KEY, {
                      suggestion: null,
                      isLoading: false,
                    })
                  );
                }
              } catch {
                // Network errors silently swallowed — canvas always wins
                if (currentRequestId === requestId) {
                  suggestionMetrics.record("network_error", "replacement");
                  editorView.dispatch(
                    editorView.state.tr.setMeta(REPLACEMENT_KEY, {
                      isLoading: false,
                    })
                  );
                }
              }
            }, extension.options.pauseDelay);
          };

          return {
            update(view, prevState) {
              if (
                view.state.doc !== prevState.doc ||
                view.state.selection !== prevState.selection
              ) {
                // Text change → record keystroke, cancel everything
                if (view.state.doc !== prevState.doc) {
                  recordKeystroke();
                  cancelCurrentRequest();

                  const s = REPLACEMENT_KEY.getState(view.state);
                  if (s?.suggestion || s?.isLoading) {
                    dismissImmediate(view);
                  }
                }

                scheduleCheck();
              }
            },

            destroy() {
              clearTimers();
              recentEditTimestamps = [];
            },
          };
        },
      }),
    ];
  },
});

export { REPLACEMENT_KEY as inlineReplacementPluginKey };
