"use client";

import { useCallback, useRef } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { SuggestionContext } from "./extensions";
import type {
  ReplacementContext,
  ReplacementSuggestion,
} from "./extensions/inlineReplacement";
import { suggestionMetrics } from "./suggestionMetrics";

/**
 * Bridges the editor's synchronous callback interface with Convex actions.
 *
 * B3.5 changes:
 * - Version-based cancellation: older in-flight requests are invalidated
 *   instantly when a newer request starts or cancelGhost/cancelReplacement
 *   is called. The network call continues but its result is discarded.
 * - Concurrent requests allowed: instead of blocking new requests while
 *   one is in-flight, we let them overlap and discard stale results.
 *
 * B3.7 changes:
 * - Exposes cancel functions for hard invalidation from the extension layer.
 * - All errors silently swallowed — canvas always wins.
 */
export function useRealtimeSuggestions(opts: {
  orgId: Id<"orgs"> | undefined;
  postId: Id<"posts"> | undefined;
  enabled: boolean;
}) {
  const { orgId, postId, enabled } = opts;

  const getGhostSuggestion = useAction(
    api.ai.realtimeSuggestions.getGhostSuggestion
  );
  const getReplacementSuggestion = useAction(
    api.ai.realtimeSuggestions.getReplacementSuggestion
  );

  // Version counters for stale-request cancellation.
  // Incrementing the version invalidates all in-flight requests
  // whose captured version doesn't match.
  const ghostVersion = useRef(0);
  const replacementVersion = useRef(0);

  /** Hard-cancel any in-flight ghost suggestion request. */
  const cancelGhost = useCallback(() => {
    ghostVersion.current++;
    suggestionMetrics.record("cancel", "ghost");
  }, []);

  /** Hard-cancel any in-flight replacement suggestion request. */
  const cancelReplacement = useCallback(() => {
    replacementVersion.current++;
    suggestionMetrics.record("cancel", "replacement");
  }, []);

  const getSuggestion = useCallback(
    async (context: SuggestionContext): Promise<string | null> => {
      if (!enabled || !orgId || !postId) return null;

      // Capture version — if it changes before the response arrives,
      // the result is stale and will be discarded.
      const version = ++ghostVersion.current;
      const startTime = Date.now();

      try {
        const result = await getGhostSuggestion({
          textBefore: context.textBefore,
          blockText: context.blockText,
          fullText: context.fullText,
          cursorPos: context.cursorPos,
          orgId,
          postId,
        });

        // Stale check — another request started while we were waiting
        if (ghostVersion.current !== version) {
          suggestionMetrics.record("stale_discard", "ghost");
          return null;
        }

        suggestionMetrics.record("trigger", "ghost", {
          latencyMs: Date.now() - startTime,
        });
        return result;
      } catch {
        // Network failures silently swallowed — canvas always wins
        if (ghostVersion.current === version) {
          suggestionMetrics.record("network_error", "ghost");
        }
        return null;
      }
    },
    [enabled, orgId, postId, getGhostSuggestion]
  );

  const getReplacementSuggestionCallback = useCallback(
    async (
      context: ReplacementContext
    ): Promise<ReplacementSuggestion | null> => {
      if (!enabled || !orgId || !postId) return null;

      const version = ++replacementVersion.current;
      const startTime = Date.now();

      try {
        const result = await getReplacementSuggestion({
          word: context.word,
          wordFrom: context.wordFrom,
          wordTo: context.wordTo,
          sentence: context.sentence,
          blockText: context.blockText,
          fullText: context.fullText,
          orgId,
          postId,
        });

        if (replacementVersion.current !== version) {
          suggestionMetrics.record("stale_discard", "replacement");
          return null;
        }

        suggestionMetrics.record("trigger", "replacement", {
          latencyMs: Date.now() - startTime,
        });

        if (!result) return null;

        return {
          original: context.word,
          replacement: result.replacement,
          reason: result.reason,
        };
      } catch {
        if (replacementVersion.current === version) {
          suggestionMetrics.record("network_error", "replacement");
        }
        return null;
      }
    },
    [enabled, orgId, postId, getReplacementSuggestion]
  );

  return {
    getSuggestion,
    getReplacementSuggestion: getReplacementSuggestionCallback,
    cancelGhost,
    cancelReplacement,
  };
}
