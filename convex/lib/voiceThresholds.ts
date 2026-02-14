/**
 * Voice safety thresholds per editorial mode.
 *
 * These are the starting points for calibration. Every threshold
 * is intentionally conservative (permissive) to avoid false
 * positives during early rollout. Tighten as evaluation data
 * accumulates and scoring proves stable.
 */

import type { VoiceThresholds, EditorialMode } from "./voiceTypes";

export const MIN_SAMPLES_FOR_ENFORCEMENT = 3;

export const MAX_CORRECTION_ATTEMPTS = 2;

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
