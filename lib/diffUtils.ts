/**
 * Diff utilities for suggestion comparison.
 * Word-level diff with paragraph awareness, normalization, and caching.
 */

import { diffWords, type Change } from "diff";

const DIFF_CACHE_MAX = 50;
const LARGE_DOC_THRESHOLD = 30_000;

/** Simple string hash for cache keys (used as a fast lookup, NOT as proof of equality). */
function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

/** Normalize text for diff comparison: line endings + collapse repeated whitespace */
export function normalizeForDiff(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function getDiffCacheKey(original: string, suggested: string): string {
  return `${simpleHash(original)}_${simpleHash(suggested)}`;
}

export function isLargeDocument(original: string, suggested: string): boolean {
  return original.length + suggested.length > LARGE_DOC_THRESHOLD;
}

export type DiffResult = {
  changes: Change[];
  addedCount: number;
  removedCount: number;
  label: "tightened" | "rephrased" | "expanded" | null;
};

type CacheEntry = {
  originalText: string;
  suggestedText: string;
  result: DiffResult;
};

const cache = new Map<string, CacheEntry>();

export function computeWordDiff(
  originalText: string,
  suggestedText: string
): DiffResult | null {
  try {
    const key = getDiffCacheKey(originalText, suggestedText);
    const cached = cache.get(key);
    // Verify actual strings match to guard against hash collisions
    if (
      cached &&
      cached.originalText === originalText &&
      cached.suggestedText === suggestedText
    ) {
      return cached.result;
    }

    const orig = normalizeForDiff(originalText);
    const sugg = normalizeForDiff(suggestedText);

    const changes = diffWords(orig, sugg);

    let addedCount = 0;
    let removedCount = 0;

    for (const c of changes) {
      if (c.added) {
        addedCount += c.value.trim().split(/\s+/).filter(Boolean).length;
      } else if (c.removed) {
        removedCount += c.value.trim().split(/\s+/).filter(Boolean).length;
      }
    }

    const netAdded = addedCount - removedCount;
    const changedCount = Math.min(addedCount, removedCount);

    let label: DiffResult["label"] = null;
    const total = addedCount + removedCount;
    if (total > 0) {
      if (netAdded < -2) label = "tightened";
      else if (netAdded > 2) label = "expanded";
      else if (changedCount > 0) label = "rephrased";
    }

    const result: DiffResult = {
      changes,
      addedCount,
      removedCount,
      label,
    };

    if (cache.size >= DIFF_CACHE_MAX) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }
    cache.set(key, { originalText, suggestedText, result });
    return result;
  } catch {
    return null;
  }
}
