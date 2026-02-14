/**
 * Regression suite gating thresholds.
 *
 * Fail the run if any metric degrades beyond these limits.
 * Tighten as you gain confidence in the baseline.
 */

export type GatingRule = {
  id: string;
  description: string;
  /** Metric key in static/live results */
  metric: string;
  /** Fail if current < baseline - tolerance (for "higher is better" metrics) */
  minDrop?: number;
  /** Fail if current > baseline + tolerance (for "lower is better" metrics) */
  maxRise?: number;
  /** Fail if absolute value drops below this */
  floor?: number;
  /** Fail if absolute value rises above this */
  ceiling?: number;
};

export const STATIC_GATING_RULES: GatingRule[] = [
  {
    id: "good_win_rate",
    description: "Good edits must outscore bad edits",
    metric: "goodWinRate",
    minDrop: 0.05,
    floor: 0.85,
  },
  {
    id: "false_negatives",
    description: "False negatives (good scored below bad) must not rise",
    metric: "falseNegatives",
    maxRise: 3,
  },
  {
    id: "mean_voice_similarity_good",
    description: "Average voice similarity for good edits must not drop",
    metric: "meanStylisticGood",
    minDrop: 0.05,
    floor: 0.70,
  },
  {
    id: "mean_semantic_good",
    description: "Average semantic similarity for good edits must not drop",
    metric: "meanSemanticGood",
    minDrop: 0.05,
    floor: 0.75,
  },
  {
    id: "mean_combined_good",
    description: "Average combined score for good edits must not drop",
    metric: "meanCombinedGood",
    minDrop: 0.05,
    floor: 0.70,
  },
];

export const LIVE_GATING_RULES: GatingRule[] = [
  {
    id: "live_voice_similarity",
    description: "Live: average voice similarity must not drop",
    metric: "meanVoiceSimilarity",
    minDrop: 0.05,
    floor: 0.65,
  },
  {
    id: "live_semantic_similarity",
    description: "Live: average semantic similarity must not drop",
    metric: "meanSemanticSimilarity",
    minDrop: 0.05,
    floor: 0.80,
  },
  {
    id: "live_pass_rate",
    description: "Live: pass rate must not drop",
    metric: "passRate",
    minDrop: 0.08,
    floor: 0.70,
  },
  {
    id: "live_drift_rate",
    description: "Live: drift rate (semantic failure) must not rise",
    metric: "driftRate",
    maxRise: 0.05,
    ceiling: 0.10,
  },
  {
    id: "live_enforcement_failure",
    description: "Live: enforcement failure rate must not rise dramatically",
    metric: "enforcementFailureRate",
    maxRise: 0.10,
    ceiling: 0.25,
  },
];
