/**
 * Hunk grouping and selective-apply logic for suggestion diffs.
 *
 * A "hunk" is a contiguous group of changed (added/removed) tokens.
 * Adjacent changed regions separated by small amounts of unchanged text
 * are merged into a single hunk to keep the toggle count manageable
 * (sentence-level, not word-level).
 */

import type { Change } from "diff";

/**
 * Maximum gap (in characters of unchanged text) between two changed
 * regions before they're treated as separate hunks.  40 chars ≈ 6–8 words,
 * which keeps most sentence-level edits in one group.
 */
const MERGE_GAP_CHARS = 40;

export type Hunk = {
  id: number;
  /** Indices into the Change[] array that belong to this hunk. */
  changeIndices: number[];
  addedWords: number;
  removedWords: number;
};

// ── Grouping ──────────────────────────────────────────────────────────────

type RawRegion = { start: number; end: number };

/**
 * Group word-level diff changes into toggleable hunks.
 *
 * 1.  Walk the Change[] and collect contiguous runs of changed tokens.
 * 2.  Merge adjacent runs if the unchanged gap between them is ≤ MERGE_GAP_CHARS.
 * 3.  Return one Hunk per merged group.
 */
export function groupChangesIntoHunks(changes: Change[]): Hunk[] {
  // Step 1 — collect raw changed regions
  const regions: RawRegion[] = [];
  let i = 0;
  while (i < changes.length) {
    if (changes[i].added || changes[i].removed) {
      const start = i;
      while (i < changes.length && (changes[i].added || changes[i].removed)) {
        i++;
      }
      regions.push({ start, end: i - 1 });
    } else {
      i++;
    }
  }

  if (regions.length === 0) return [];

  // Step 2 — merge nearby regions
  const merged: RawRegion[] = [{ ...regions[0] }];

  for (let r = 1; r < regions.length; r++) {
    const prev = merged[merged.length - 1];
    const curr = regions[r];

    // Measure the unchanged gap between prev and curr
    let gapChars = 0;
    for (let g = prev.end + 1; g < curr.start; g++) {
      gapChars += changes[g].value.length;
    }

    if (gapChars <= MERGE_GAP_CHARS) {
      prev.end = curr.end; // merge
    } else {
      merged.push({ ...curr });
    }
  }

  // Step 3 — build Hunk objects (only changed indices, not the gap context)
  return merged.map((region, idx) => {
    const changeIndices: number[] = [];
    let addedWords = 0;
    let removedWords = 0;

    for (let ci = region.start; ci <= region.end; ci++) {
      const c = changes[ci];
      if (c.added || c.removed) {
        changeIndices.push(ci);
        const words = c.value.trim().split(/\s+/).filter(Boolean).length;
        if (c.added) addedWords += words;
        else removedWords += words;
      }
    }

    return { id: idx, changeIndices, addedWords, removedWords };
  });
}

// ── Selective apply ───────────────────────────────────────────────────────

/**
 * Rebuild final text by applying only enabled hunks onto the original.
 *
 * -  Unchanged tokens → always included.
 * -  Added tokens → included only if their hunk is **enabled** (accept edit).
 * -  Removed tokens → included only if their hunk is **disabled** (keep original).
 *
 * When every hunk is enabled the output equals the full suggested text.
 * When every hunk is disabled the output equals the full original text.
 */
export function applySelectedHunks(
  changes: Change[],
  hunks: Hunk[],
  enabledHunkIds: ReadonlySet<number>
): string {
  // Fast-path: build a lookup from change-index → hunkId
  const changeToHunk = new Map<number, number>();
  for (const h of hunks) {
    for (const idx of h.changeIndices) {
      changeToHunk.set(idx, h.id);
    }
  }

  let result = "";
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const hunkId = changeToHunk.get(i);

    if (hunkId === undefined) {
      // Unchanged — always present in output
      result += c.value;
    } else {
      const enabled = enabledHunkIds.has(hunkId);
      if (c.added) {
        if (enabled) result += c.value;
        // disabled → skip the addition (revert to original)
      } else if (c.removed) {
        if (!enabled) result += c.value;
        // enabled → skip the removal (accept the change)
      }
    }
  }
  return result;
}

/** Returns true when every hunk in the list is enabled. */
export function allHunksEnabled(
  hunks: Hunk[],
  enabledHunkIds: ReadonlySet<number>
): boolean {
  return hunks.length > 0 && hunks.every((h) => enabledHunkIds.has(h.id));
}

/** Create a Set with all hunk ids enabled. */
export function allHunkIds(hunks: Hunk[]): Set<number> {
  return new Set(hunks.map((h) => h.id));
}
