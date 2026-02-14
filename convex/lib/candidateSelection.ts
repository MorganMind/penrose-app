/**
 * Candidate selection and scoring for multi-candidate refinement.
 *
 * The selection score is distinct from the voice safety combined score.
 * Safety scores determine pass/fail against thresholds.
 * Selection scores determine which passing candidate to present.
 *
 * Selection weights prioritize:
 *  1. Voice preservation (stylistic) — highest
 *  2. Meaning preservation (semantic) — second
 *  3. Editorial compliance (scope) — third
 */

export type CandidateScores = {
  semanticScore: number;
  stylisticScore: number;
  scopeScore: number;
  combinedScore: number;
};

/**
 * Selection weights — different from the mode-specific safety weights.
 * These reflect the product priority: voice > meaning > scope.
 */
const SELECTION_WEIGHTS = {
  stylistic: 0.45,
  semantic: 0.35,
  scope: 0.2,
};

/**
 * Compute the selection score used to rank candidates.
 * Higher = better candidate for presentation.
 */
export function computeSelectionScore(scores: CandidateScores): number {
  return (
    scores.stylisticScore * SELECTION_WEIGHTS.stylistic +
    scores.semanticScore * SELECTION_WEIGHTS.semantic +
    scores.scopeScore * SELECTION_WEIGHTS.scope
  );
}

export type RankedCandidate = {
  index: number;
  selectionScore: number;
  passed: boolean;
  scores: CandidateScores;
};

/**
 * Select the best candidate from a ranked list.
 *
 * Priority order:
 *  1. Highest-scoring candidate that passes all thresholds
 *  2. If none pass, return null (caller should generate fallback)
 */
export function selectBestCandidate(
  candidates: RankedCandidate[]
): RankedCandidate | null {
  const passing = candidates
    .filter((c) => c.passed)
    .sort((a, b) => b.selectionScore - a.selectionScore);

  return passing.length > 0 ? passing[0] : null;
}

/**
 * Given all candidates (including fallback), select the final winner.
 * If any pass, pick the best passing. Otherwise pick the highest scorer.
 */
export function selectFinalCandidate(
  candidates: RankedCandidate[]
): { winner: RankedCandidate; fallbackUsed: boolean } {
  const passing = candidates
    .filter((c) => c.passed)
    .sort((a, b) => b.selectionScore - a.selectionScore);

  if (passing.length > 0) {
    return { winner: passing[0], fallbackUsed: false };
  }

  // No passing candidates — pick highest scorer as least-bad option
  const sorted = [...candidates].sort(
    (a, b) => b.selectionScore - a.selectionScore
  );
  return {
    winner: sorted[0],
    fallbackUsed: true,
  };
}
