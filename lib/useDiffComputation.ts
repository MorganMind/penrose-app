"use client";

import { useMemo, useState, useEffect } from "react";
import {
  computeWordDiff,
  isLargeDocument,
  type DiffResult,
} from "@/lib/diffUtils";
import { groupChangesIntoHunks, type Hunk } from "@/lib/diffHunks";

export type DiffComputationResult = {
  /** The word-level diff result (null while computing or on error). */
  result: DiffResult | null;
  /** Hunks grouped from the diff (empty until result is ready). */
  hunks: Hunk[];
  /** True while awaiting deferred computation for large documents. */
  computing: boolean;
  /** True if computation failed. */
  error: boolean;
};

/**
 * Computes word-level diff and groups changes into hunks.
 * Defers computation for large documents via requestIdleCallback.
 * Results are cached in the diff utility layer.
 */
export function useDiffComputation(
  originalText: string,
  suggestedText: string
): DiffComputationResult {
  const [result, setResult] = useState<DiffResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState(false);

  const isLarge = useMemo(
    () => isLargeDocument(originalText, suggestedText),
    [originalText, suggestedText]
  );

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(false);
    if (isLarge) setComputing(true);

    const run = () => {
      const r = computeWordDiff(originalText, suggestedText);
      if (cancelled) return;

      if (r) {
        setResult(r);
      } else {
        setError(true);
      }
      setComputing(false);
    };

    if (isLarge) {
      const useIdle = typeof requestIdleCallback !== "undefined";
      const id = useIdle
        ? requestIdleCallback(run, { timeout: 500 })
        : setTimeout(run, 100);
      return () => {
        cancelled = true;
        useIdle ? cancelIdleCallback(id as number) : clearTimeout(id);
      };
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [originalText, suggestedText, isLarge]);

  const hunks = useMemo(() => {
    if (!result) return [];
    return groupChangesIntoHunks(result.changes);
  }, [result]);

  return { result, hunks, computing, error };
}
