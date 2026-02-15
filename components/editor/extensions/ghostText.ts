"use client";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { suggestionMetrics } from "../suggestionMetrics";

/**
 * Ghost Text Extension for Real-Time Writing Suggestions
 *
 * B3.5 — Latency Masking & Stability:
 * - Two-phase scheduling: prefetch at 300ms, display at full pauseDelay
 * - Throttle: max one suggestion per 2 seconds
 * - LRU cache: instant restore for repeated patterns (20 entries, 60s TTL)
 * - Prefetch-next: after rendering a suggestion, prefetch the hypothetical
 *   continuation (what text would look like if user accepts)
 * - Hard stale-request cancellation via version counter
 * - Network failures silently swallowed
 *
 * B3.7 — Stability & Edge Case Hardening:
 * - Rapid typing detection: suppresses triggers during fast keystroke bursts
 * - Selection guard: no triggers during text selection
 * - Multi-cursor guard: only primary cursor (first selection range)
 * - Conflicting edit guard: doc changes during fetch invalidate immediately
 * - Canvas always wins: typing instantly clears suggestions, never blocked
 * - Internal metrics via suggestionMetrics
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
  /** Hard-cancel any in-flight suggestion request at the hook level. */
  cancelSuggestion?: () => void;
  /** Pause duration before displaying suggestion (ms). Default: 900 */
  pauseDelay?: number;
  /** Delay before starting prefetch (ms). Default: 300 */
  prefetchDelay?: number;
  /** Minimum gap between displayed suggestions (ms). Default: 2000 */
  throttleInterval?: number;
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
  /** Block-scoped cache for backspace restoration (single-entry, compat) */
  cache: {
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

// ── B3.5/B3.7 Constants ──
const DEFAULT_PREFETCH_DELAY = 300;
const DEFAULT_THROTTLE_INTERVAL = 2000;
const RAPID_TYPING_THRESHOLD = 4; // keystrokes within pause window
const LRU_CACHE_SIZE = 20;
const LRU_CACHE_TTL = 60_000; // 60 seconds

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

// ── LRU Cache ──
interface CacheEntry {
  suggestion: string;
  timestamp: number;
}

class SuggestionLRUCache {
  private map = new Map<string, CacheEntry>();
  private readonly maxSize: number;
  private readonly ttl: number;

  constructor(maxSize: number = LRU_CACHE_SIZE, ttl: number = LRU_CACHE_TTL) {
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  get(key: string): string | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.map.delete(key);
      return null;
    }
    // Move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.suggestion;
  }

  set(key: string, suggestion: string) {
    // Delete first to reset insertion order
    this.map.delete(key);
    if (this.map.size >= this.maxSize) {
      // Evict oldest (first key)
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { suggestion, timestamp: Date.now() });
  }

  /** Check if key exists and is not expired (without promoting) */
  has(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  clear() {
    this.map.clear();
  }
}

export const GhostText = Extension.create<GhostTextOptions>({
  name: "ghostText",

  addOptions() {
    return {
      getSuggestion: undefined,
      cancelSuggestion: undefined,
      pauseDelay: 900,
      prefetchDelay: DEFAULT_PREFETCH_DELAY,
      throttleInterval: DEFAULT_THROTTLE_INTERVAL,
      enabled: true,
    };
  },

  addProseMirrorPlugins() {
    const extension = this;

    // ── Timers ──
    let prefetchTimer: ReturnType<typeof setTimeout> | null = null;
    let displayTimer: ReturnType<typeof setTimeout> | null = null;
    let fadeOutTimer: ReturnType<typeof setTimeout> | null = null;
    let highlightTimer: ReturnType<typeof setTimeout> | null = null;
    let phaseIconTimer: ReturnType<typeof setTimeout> | null = null;
    let phaseShimmerTimer: ReturnType<typeof setTimeout> | null = null;

    // ── State ──
    let currentRequestId = 0;
    let lastDisplayTime = 0;
    const lruCache = new SuggestionLRUCache();

    // Prefetch buffer: holds a suggestion fetched early, waiting for display
    let prefetchBuffer: {
      suggestion: string | null;
      textBefore: string;
      requestId: number;
      cursorPos: number;
    } | null = null;

    // Rapid typing detection
    let recentEditTimestamps: number[] = [];

    // Track doc version for conflicting-edit detection
    let docAtRequestStart: any = null;

    const clearPhaseTimers = () => {
      if (phaseIconTimer) { clearTimeout(phaseIconTimer); phaseIconTimer = null; }
      if (phaseShimmerTimer) { clearTimeout(phaseShimmerTimer); phaseShimmerTimer = null; }
    };

    const clearAllTimers = () => {
      if (prefetchTimer) { clearTimeout(prefetchTimer); prefetchTimer = null; }
      if (displayTimer) { clearTimeout(displayTimer); displayTimer = null; }
      if (fadeOutTimer) { clearTimeout(fadeOutTimer); fadeOutTimer = null; }
      if (highlightTimer) { clearTimeout(highlightTimer); highlightTimer = null; }
      clearPhaseTimers();
    };

    /**
     * Increment request ID, clear all timers, cancel in-flight hook request,
     * and clear prefetch buffer. Every path that invalidates the current
     * request MUST call this.
     */
    const cancelCurrentRequest = () => {
      currentRequestId++;
      prefetchBuffer = null;
      docAtRequestStart = null;
      clearAllTimers();
      // Hard-cancel at the hook level so the version counter invalidates
      // the in-flight network request's result.
      extension.options.cancelSuggestion?.();
    };

    const recordKeystroke = () => {
      recentEditTimestamps.push(Date.now());
    };

    const isRapidTyping = (): boolean => {
      const now = Date.now();
      const window = extension.options.pauseDelay ?? 900;
      recentEditTimestamps = recentEditTimestamps.filter(
        (t) => now - t < window
      );
      return recentEditTimestamps.length >= RAPID_TYPING_THRESHOLD;
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

      const $pos = state.doc.resolve(pos);
      const offsetInBlock = pos - $pos.start();
      const blockTextBefore = $pos.parent.textContent.slice(0, offsetInBlock);

      const tr = state.tr.insertText(text, pos);
      const insertEnd = pos + text.length;

      clearPhaseTimers();

      // Update backspace-restore cache
      const newCache = remainingGhostText
        ? {
            textBefore: blockTextBefore + text,
            suggestion: remainingGhostText,
            pos: insertEnd,
          }
        : null;

      // Also update LRU cache for the accepted state
      if (remainingGhostText) {
        lruCache.set(blockTextBefore + text, remainingGhostText);
      }

      tr.setMeta(ghostTextPluginKey, {
        ghostText: remainingGhostText,
        ghostPos: remainingGhostText ? insertEnd : null,
        isLoading: false,
        loadingPhase: "hidden",
        loadingPos: null,
        isFadingOut: false,
        acceptedRange: { from: pos, to: insertEnd },
        cache: newCache,
      });

      view.dispatch(tr);

      // Record acceptance
      suggestionMetrics.record("accept", "ghost");

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

      // ── B3.5: Prefetch next candidate ──
      // After a suggestion is fully accepted, prefetch what comes next
      if (!remainingGhostText && extension.options.getSuggestion) {
        const hypotheticalTextBefore = blockTextBefore + text;
        const fullText = state.doc.textContent;
        // Only prefetch if not already cached
        if (!lruCache.has(hypotheticalTextBefore)) {
          suggestionMetrics.record("prefetch_start", "ghost");
          extension.options
            .getSuggestion({
              textBefore: hypotheticalTextBefore,
              fullText,
              cursorPos: insertEnd,
              blockText: $pos.parent.textContent + text,
            })
            .then((result) => {
              if (result) {
                lruCache.set(hypotheticalTextBefore, result);
              }
            })
            .catch(() => {
              // Prefetch errors are non-critical — swallow silently
            });
        }
      }
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

      suggestionMetrics.record("reject", "ghost");

      view.dispatch(
        view.state.tr.setMeta(ghostTextPluginKey, { isFadingOut: true })
      );

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
            const meta = tr.getMeta(ghostTextPluginKey);
            if (meta) {
              return { ...prev, ...meta };
            }

            if (!tr.docChanged) return prev;

            // ── Document changed (typing, undo, paste, etc.) ──
            // Canvas ALWAYS wins: immediately clear all suggestion state

            const next: GhostTextState = { ...prev };

            if (prev.ghostText !== null && !prev.isFadingOut) {
              next.ghostText = null;
              next.ghostPos = null;
            }

            if (prev.isLoading) {
              next.isLoading = false;
              next.loadingPhase = "hidden";
              next.loadingPos = null;
            }

            if (prev.isFadingOut) {
              next.isFadingOut = false;
              next.ghostText = null;
              next.ghostPos = null;
            }

            // Map accepted highlight through document changes
            if (prev.acceptedRange) {
              const from = tr.mapping.map(prev.acceptedRange.from);
              const to = tr.mapping.map(prev.acceptedRange.to);
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
              dismissWithFade(view, true);
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
          handleClick(view, _pos, event) {
            const s = ghostTextPluginKey.getState(view.state);
            if (!s?.ghostText || s.isFadingOut || s.ghostPos === null) {
              return false;
            }

            const target = event.target as HTMLElement | null;

            if (target?.closest?.(`[${GHOST_WRAPPER_ATTR}]`)) {
              event.preventDefault();
              acceptText(view, s.ghostText, s.ghostPos, null);
              return true;
            }

            dismissWithFade(view, false);
            return false;
          },

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
          /**
           * Two-phase suggestion scheduling (B3.5):
           *
           * Phase 1 — Prefetch (300ms after pause):
           *   Start the network request early. Result goes into prefetchBuffer.
           *
           * Phase 2 — Display (900ms after pause):
           *   Show the suggestion. If prefetch already completed, display is
           *   instant. Otherwise show loading indicator and wait for result.
           *
           * If typing resumes during either phase, everything is cancelled.
           */
          const scheduleCheck = () => {
            if (!extension.options.enabled || !extension.options.getSuggestion) {
              return;
            }

            // Clear previous scheduling cycle
            cancelCurrentRequest();

            const prefetchDelay = extension.options.prefetchDelay ?? DEFAULT_PREFETCH_DELAY;
            const displayDelay = extension.options.pauseDelay ?? 900;
            const throttleInterval = extension.options.throttleInterval ?? DEFAULT_THROTTLE_INTERVAL;

            // ── Phase 1: Prefetch ──
            prefetchTimer = setTimeout(() => {
              prefetchTimer = null;
              const { state } = editorView;
              const { selection, doc } = state;

              // ── B3.7: Selection guard ──
              if (!selection.empty) {
                suggestionMetrics.record("selection_skip", "ghost");
                return;
              }

              // ── B3.7: Multi-cursor guard — only primary cursor ──
              // ProseMirror represents multi-cursor as multiple ranges in
              // selection.ranges. We only act on the primary (first) range.
              // If there are multiple ranges, skip to avoid confusion.
              if ("ranges" in selection && Array.isArray((selection as any).ranges) && (selection as any).ranges.length > 1) {
                return;
              }

              const $pos = doc.resolve(selection.from);
              const blockStart = $pos.start();
              const offsetInBlock = selection.from - blockStart;
              const blockText = $pos.parent.textContent ?? "";
              const textBefore = blockText.slice(0, offsetInBlock);
              const textAfter = blockText.slice(offsetInBlock);

              // Block if cursor is truly mid-word
              if (isCursorMidWord(textBefore, textAfter)) {
                return;
              }

              // ── B3.7: Rapid typing guard ──
              if (isRapidTyping()) {
                suggestionMetrics.record("rapid_typing_skip", "ghost");
                return;
              }

              // Trigger conditions: sentence completion OR pause after content
              const isSentenceEnd = SENTENCE_END.test(textBefore);
              const hasContent = textBefore.trim().length > 0;

              if (!isSentenceEnd && !hasContent) {
                return;
              }

              // ── LRU cache check ──
              const cached = lruCache.get(textBefore);
              if (cached) {
                suggestionMetrics.record("cache_hit", "ghost");
                prefetchBuffer = {
                  suggestion: cached,
                  textBefore,
                  requestId: currentRequestId,
                  cursorPos: selection.from,
                };
                return; // Display phase will pick this up
              }

              // ── Backspace single-entry cache check ──
              const pluginState = ghostTextPluginKey.getState(state);
              if (pluginState?.cache?.textBefore === textBefore) {
                suggestionMetrics.record("cache_hit", "ghost");
                prefetchBuffer = {
                  suggestion: pluginState.cache.suggestion,
                  textBefore,
                  requestId: currentRequestId,
                  cursorPos: selection.from,
                };
                return;
              }

              // ── Start prefetch ──
              const requestId = currentRequestId;
              docAtRequestStart = doc;

              suggestionMetrics.record("prefetch_start", "ghost");

              const context: SuggestionContext = {
                textBefore,
                fullText: doc.textContent,
                cursorPos: selection.from,
                blockText,
              };

              extension.options.getSuggestion!(context)
                .then((suggestion) => {
                  // Stale check — if request was cancelled, discard
                  if (currentRequestId !== requestId) {
                    suggestionMetrics.record("stale_discard", "ghost");
                    return;
                  }

                  // ── B3.7: Conflicting edit check ──
                  if (editorView.state.doc !== docAtRequestStart) {
                    suggestionMetrics.record("conflict_skip", "ghost");
                    cancelCurrentRequest();
                    return;
                  }

                  // Store in prefetch buffer
                  prefetchBuffer = {
                    suggestion,
                    textBefore,
                    requestId,
                    cursorPos: selection.from,
                  };

                  // Cache the result
                  if (suggestion) {
                    lruCache.set(textBefore, suggestion);
                  }

                  // If display timer already fired (edge case: slow prefetch),
                  // dispatch the result now
                  if (!displayTimer) {
                    displayPrefetchedResult(editorView, requestId);
                  }
                })
                .catch(() => {
                  // Network failures silently swallowed
                  if (currentRequestId === requestId) {
                    suggestionMetrics.record("network_error", "ghost");
                  }
                  // If display timer already fired, clear loading
                  if (!displayTimer && currentRequestId === requestId) {
                    clearPhaseTimers();
                    try {
                      editorView.dispatch(
                        editorView.state.tr.setMeta(ghostTextPluginKey, {
                          isLoading: false,
                          loadingPhase: "hidden",
                          loadingPos: null,
                        })
                      );
                    } catch {
                      // View may be destroyed — swallow
                    }
                  }
                });
            }, prefetchDelay);

            // ── Phase 2: Display ──
            displayTimer = setTimeout(() => {
              displayTimer = null;
              const requestId = currentRequestId;

              // ── B3.5: Throttle check ──
              const now = Date.now();
              if (now - lastDisplayTime < throttleInterval) {
                suggestionMetrics.record("throttle_skip", "ghost");
                // Don't cancel the prefetch — it may be useful later.
                // Just skip displaying this time.
                return;
              }

              // If prefetch already completed, display immediately
              if (prefetchBuffer && prefetchBuffer.requestId === requestId) {
                displayPrefetchedResult(editorView, requestId);
                return;
              }

              // Prefetch still in-flight: show loading indicator
              const { state } = editorView;
              const { selection } = state;

              if (!selection.empty) return;

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
            }, displayDelay);
          };

          /**
           * Display a prefetched suggestion result.
           */
          const displayPrefetchedResult = (
            view: { state: any; dispatch: any },
            requestId: number
          ) => {
            if (!prefetchBuffer || prefetchBuffer.requestId !== requestId) return;
            if (currentRequestId !== requestId) return;

            // ── B3.5: Throttle check (also checked at display time) ──
            const now = Date.now();
            const throttleInterval = extension.options.throttleInterval ?? DEFAULT_THROTTLE_INTERVAL;
            if (now - lastDisplayTime < throttleInterval) {
              suggestionMetrics.record("throttle_skip", "ghost");
              return;
            }

            const { suggestion, textBefore } = prefetchBuffer;
            const { state } = view;
            const { selection } = state;

            clearPhaseTimers();
            prefetchBuffer = null;

            if (suggestion) {
              lastDisplayTime = Date.now();
              suggestionMetrics.record("prefetch_hit", "ghost");
            }

            view.dispatch(
              state.tr.setMeta(ghostTextPluginKey, {
                ghostText: suggestion ?? null,
                ghostPos: suggestion ? selection.from : null,
                isLoading: false,
                loadingPhase: "hidden",
                loadingPos: null,
                isFadingOut: false,
                cache: suggestion
                  ? { textBefore, suggestion, pos: selection.from }
                  : (ghostTextPluginKey.getState(state)?.cache ?? null),
              })
            );
          };

          return {
            update(view, prevState) {
              if (
                view.state.doc !== prevState.doc ||
                view.state.selection !== prevState.selection
              ) {
                // Text change → cancel everything, record keystroke
                if (view.state.doc !== prevState.doc) {
                  recordKeystroke();
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
              lruCache.clear();
              recentEditTimestamps = [];
            },
          };
        },
      }),
    ];
  },
});

export { ghostTextPluginKey };
