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
 *
 * Four independent components:
 *  1. Word confidence — total corpus size
 *  2. Sample confidence — number of distinct contributions
 *  3. Diversity score — variety of source types and posts
 *  4. Temporal spread — samples distributed over time vs. bulk-loaded
 *
 * All computations are deterministic. Same inputs → same confidence.
 */

// ── Types ────────────────────────────────────────────────────────────────

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

export type SourceTypeCounts = {
  published_post: number;
  manual_revision: number;
  initial_draft: number;
  baseline_sample: number;
};

export type DiversityInputs = {
  uniqueSourceTypes: number;
  uniquePostIds: number;
  sourceTypeCounts: SourceTypeCounts;
  sampleCount: number;
};

// ── Constants ────────────────────────────────────────────────────────────

/**
 * Word confidence reaches 0.5 at ~1400 words, 0.9 at ~4600 words.
 * Authors writing 2–3 medium posts have strong word confidence.
 */
const WORD_HALF_LIFE = 2000;

/**
 * Sample confidence reaches 0.5 at ~3.5 samples, 0.9 at ~11.5 samples.
 * Publishing 4+ pieces builds solid sample confidence.
 */
const SAMPLE_HALF_LIFE = 5;

/**
 * Minimum temporal spread (in ms) for full temporal credit.
 * 14 days — samples spread over 2+ weeks get full marks.
 */
const TEMPORAL_FULL_CREDIT_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Minimum temporal spread for any temporal credit.
 * Samples all within 1 hour count as "no spread."
 */
const TEMPORAL_MINIMUM_MS = 60 * 60 * 1000;

// ── Band boundaries ──────────────────────────────────────────────────────

const LOW_CEILING = 0.4;
const HIGH_FLOOR = 0.7;

export function classifyBand(confidence: number): ConfidenceBand {
  if (confidence < LOW_CEILING) return "low";
  if (confidence >= HIGH_FLOOR) return "high";
  return "medium";
}

// ── Main computation ─────────────────────────────────────────────────────

export function computeConfidence(
  totalWordCount: number,
  sampleCount: number,
  diversity: DiversityInputs,
  oldestSampleAt: number,
  newestSampleAt: number
): ProfileConfidence {
  // ── Word confidence ──────────────────────────────────────
  const wordConfidence =
    totalWordCount <= 0
      ? 0
      : 1 - Math.exp(-totalWordCount / WORD_HALF_LIFE);

  // ── Sample confidence ────────────────────────────────────
  const sampleConfidence =
    sampleCount <= 0
      ? 0
      : 1 - Math.exp(-sampleCount / SAMPLE_HALF_LIFE);

  // ── Diversity score ──────────────────────────────────────
  const diversityScore = computeDiversityScore(diversity);

  // ── Temporal spread ──────────────────────────────────────
  const temporalSpread = computeTemporalSpread(
    oldestSampleAt,
    newestSampleAt
  );

  // ── Composite ────────────────────────────────────────────
  // The floor is the lesser of word and sample confidence —
  // you need both volume and repetition.
  // Diversity and temporal spread are multipliers (0.6–1.0 range).
  const floor = Math.min(wordConfidence, sampleConfidence);
  const diversityMultiplier = 0.6 + 0.4 * diversityScore;
  const temporalMultiplier = 0.8 + 0.2 * temporalSpread;

  const overall = Math.min(
    1,
    floor * diversityMultiplier * temporalMultiplier
  );

  return {
    overall,
    components: {
      wordConfidence,
      sampleConfidence,
      diversityScore,
      temporalSpread,
    },
    band: classifyBand(overall),
  };
}

// ── Diversity computation ────────────────────────────────────────────────

/**
 * Diversity is a 0–1 score based on:
 *  - Source type variety (30%): how many of the 4 source types are present
 *  - Post variety (40%): how many distinct posts contributed
 *  - Distribution evenness (30%): how evenly distributed across source types
 *
 * A profile built from 5 published posts and 3 manual revisions across
 * 4 different posts scores higher than one built from 8 initial drafts
 * of the same post.
 */
function computeDiversityScore(d: DiversityInputs): number {
  if (d.sampleCount <= 1) return 0;

  // Source type variety: 0–1 (4 possible types)
  const maxSourceTypes = 4;
  const typeVariety = Math.min(1, d.uniqueSourceTypes / maxSourceTypes);

  // Post variety: 0–1, saturates at 5 unique posts
  const postVariety = Math.min(1, d.uniquePostIds / 5);

  // Distribution evenness: Shannon entropy normalized by max entropy
  const counts = Object.values(d.sourceTypeCounts).filter((c) => c > 0);
  let evenness = 0;
  if (counts.length > 1) {
    const total = counts.reduce((a, b) => a + b, 0);
    const probs = counts.map((c) => c / total);
    const entropy = -probs.reduce(
      (acc, p) => acc + (p > 0 ? p * Math.log2(p) : 0),
      0
    );
    const maxEntropy = Math.log2(counts.length);
    evenness = maxEntropy > 0 ? entropy / maxEntropy : 0;
  }

  return typeVariety * 0.3 + postVariety * 0.4 + evenness * 0.3;
}

// ── Temporal spread computation ──────────────────────────────────────────

function computeTemporalSpread(
  oldestAt: number,
  newestAt: number
): number {
  const span = newestAt - oldestAt;
  if (span < TEMPORAL_MINIMUM_MS) return 0;
  return Math.min(1, span / TEMPORAL_FULL_CREDIT_MS);
}

// ── Enforcement modulation ───────────────────────────────────────────────

/**
 * Confidence-aware threshold adjustments.
 *
 * Returns multipliers that the enforcement system applies to its
 * base thresholds. At low confidence, stylistic thresholds relax
 * and semantic thresholds tighten. At high confidence, all
 * thresholds apply at their base values.
 *
 * The transition is smooth (linear interpolation through the medium
 * band) so there are no cliff edges when crossing boundaries.
 */
export type ThresholdModulation = {
  /** Multiply stylistic pass floor by this (< 1 = more lenient) */
  stylisticRelaxation: number;
  /** Multiply semantic pass floor by this (> 1 = stricter) */
  semanticTightening: number;
  /** Multiply stylistic warning floor by this */
  stylisticWarningRelaxation: number;
  /** Multiply drift ceiling by this (> 1 = more sensitive to drift) */
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
  // Normalized position: 0 = LOW_CEILING, 1 = HIGH_FLOOR
  const t = Math.max(
    0,
    Math.min(1, (confidence - LOW_CEILING) / (HIGH_FLOOR - LOW_CEILING))
  );

  // Below LOW_CEILING: full low-confidence modulation
  const effective = confidence < LOW_CEILING ? 0 : t;

  return {
    stylisticRelaxation: lerp(0.75, 1.0, effective),
    semanticTightening: lerp(1.08, 1.0, effective),
    stylisticWarningRelaxation: lerp(0.80, 1.0, effective),
    driftSensitivity: lerp(1.06, 1.0, effective),
  };
}

// ── Scoring weight modulation ────────────────────────────────────────────

/**
 * Confidence-aware scoring weight adjustments.
 *
 * At low confidence: semantic weight +25%, stylistic weight -30%
 * At high confidence: base weights apply
 */
export type ScoringModulation = {
  semanticMultiplier: number;
  stylisticMultiplier: number;
  scopeMultiplier: number;
};

export function computeScoringModulation(
  confidence: number
): ScoringModulation {
  const t = Math.max(
    0,
    Math.min(1, (confidence - LOW_CEILING) / (HIGH_FLOOR - LOW_CEILING))
  );
  const effective = confidence < LOW_CEILING ? 0 : t;

  return {
    semanticMultiplier: lerp(1.25, 1.0, effective),
    stylisticMultiplier: lerp(0.70, 1.0, effective),
    scopeMultiplier: lerp(1.05, 1.0, effective),
  };
}

/**
 * At low confidence, dampen the penalty for individual stylistic
 * feature deviations. A new profile shouldn't aggressively penalize
 * differences it hasn't confirmed through repetition.
 *
 * Returns a multiplier (0–1) for the stylistic feature distance.
 * At low confidence: feature deltas are dampened by 40%
 * At high confidence: full feature penalties apply
 */
export function computeFeatureSensitivity(confidence: number): number {
  const t = Math.max(
    0,
    Math.min(1, (confidence - LOW_CEILING) / (HIGH_FLOOR - LOW_CEILING))
  );
  const effective = confidence < LOW_CEILING ? 0 : t;
  return lerp(0.60, 1.0, effective);
}

// ── Utility ──────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
