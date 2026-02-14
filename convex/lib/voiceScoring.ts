/**
 * Voice similarity scoring.
 *
 * Three independent dimensions:
 *  1. Semantic preservation — embeddings cosine similarity
 *  2. Stylistic preservation — fingerprint distance vs voice profile
 *  3. Scope compliance — structural boundaries per editorial mode
 *
 * All scores are 0–1 where 1 = perfect preservation.
 */

import type {
  VoiceFingerprint,
  VoiceScores,
  VoiceThresholds,
  ScoringWeights,
  EditorialMode,
  PunctuationFrequencies,
} from "./voiceTypes";
import {
  computeScoringModulation,
  computeFeatureSensitivity,
} from "./profileConfidence";

// ── Stylistic scoring ────────────────────────────────────────────────────────

const STYLISTIC_WEIGHTS: Record<string, number> = {
  avgSentenceLength: 0.12,
  sentenceLengthStdDev: 0.08,
  avgParagraphLength: 0.05,
  punctuationSimilarity: 0.14,
  adjectiveAdverbDensity: 0.06,
  hedgingFrequency: 0.08,
  stopwordDensity: 0.04,
  contractionFrequency: 0.10,
  questionRatio: 0.05,
  exclamationRatio: 0.04,
  vocabularyRichness: 0.06,
  avgWordLength: 0.04,
  readabilityScore: 0.06,
  complexityScore: 0.04,
  lexicalSignatureSimilarity: 0.12,
};

const FEATURE_RANGES: Record<string, number> = {
  avgSentenceLength: 20,
  sentenceLengthStdDev: 15,
  avgParagraphLength: 8,
  adjectiveAdverbDensity: 0.15,
  hedgingFrequency: 0.5,
  stopwordDensity: 0.2,
  contractionFrequency: 0.08,
  questionRatio: 0.3,
  exclamationRatio: 0.2,
  vocabularyRichness: 0.3,
  avgWordLength: 2.0,
  readabilityScore: 10,
  complexityScore: 1.0,
};

function scalarSimilarity(a: number, b: number, range: number): number {
  const diff = Math.abs(a - b);
  return Math.max(0, 1 - diff / range);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function punctuationSimilarity(
  a: PunctuationFrequencies,
  b: PunctuationFrequencies
): number {
  const keysA = Object.keys(a) as (keyof PunctuationFrequencies)[];
  const vecA = keysA.map((k) => a[k]);
  const vecB = keysA.map((k) => b[k]);
  return cosineSimilarity(vecA, vecB);
}

function lexicalSignatureSimilarity(
  a: { word: string; frequency: number }[],
  b: { word: string; frequency: number }[]
): number {
  const mapA = new Map(a.map((e) => [e.word, e.frequency]));
  const mapB = new Map(b.map((e) => [e.word, e.frequency]));

  const allWords = new Set([...mapA.keys(), ...mapB.keys()]);
  if (allWords.size === 0) return 1;

  let totalSim = 0;
  let totalWeight = 0;

  for (const word of allWords) {
    const freqA = mapA.get(word) ?? 0;
    const freqB = mapB.get(word) ?? 0;
    const maxFreq = Math.max(freqA, freqB);
    if (maxFreq === 0) continue;

    const weight = maxFreq;
    const sim = 1 - Math.abs(freqA - freqB) / maxFreq;
    totalSim += sim * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? totalSim / totalWeight : 1;
}

/**
 * Dampening pushes a similarity score toward 1.0 (no penalty)
 * by the dampening factor. At sensitivity=0.6, a raw score of 0.5
 * becomes 0.5 + (1.0 - 0.5) * (1 - 0.6) = 0.5 + 0.2 = 0.7.
 *
 * This means low-confidence profiles don't harshly penalize
 * stylistic deviations the profile hasn't confirmed.
 */
function applyDampening(rawScore: number, sensitivity: number): number {
  return rawScore + (1.0 - rawScore) * (1 - sensitivity);
}

/**
 * Compute stylistic preservation with confidence-aware sensitivity.
 *
 * At low profile confidence, individual feature penalties are dampened
 * because the profile hasn't been confirmed through repetition.
 * The dampening factor ranges from 0.60 (low) to 1.0 (high).
 *
 * @param suggestion       Candidate fingerprint
 * @param profile          Voice profile fingerprint
 * @param profileConfidence 0–1 profile confidence (pass null for no dampening)
 */
export function computeStylisticScore(
  suggestion: VoiceFingerprint,
  profile: VoiceFingerprint,
  profileConfidence?: number | null
): number {
  const sensitivity =
    profileConfidence != null
      ? computeFeatureSensitivity(profileConfidence)
      : 1.0;

  const scores: Record<string, number> = {
    avgSentenceLength: applyDampening(
      scalarSimilarity(
        suggestion.avgSentenceLength,
        profile.avgSentenceLength,
        FEATURE_RANGES.avgSentenceLength
      ),
      sensitivity
    ),
    sentenceLengthStdDev: applyDampening(
      scalarSimilarity(
        suggestion.sentenceLengthStdDev,
        profile.sentenceLengthStdDev,
        FEATURE_RANGES.sentenceLengthStdDev
      ),
      sensitivity
    ),
    avgParagraphLength: applyDampening(
      scalarSimilarity(
        suggestion.avgParagraphLength,
        profile.avgParagraphLength,
        FEATURE_RANGES.avgParagraphLength
      ),
      sensitivity
    ),
    punctuationSimilarity: applyDampening(
      punctuationSimilarity(
        suggestion.punctuationFrequencies,
        profile.punctuationFrequencies
      ),
      sensitivity
    ),
    adjectiveAdverbDensity: applyDampening(
      scalarSimilarity(
        suggestion.adjectiveAdverbDensity,
        profile.adjectiveAdverbDensity,
        FEATURE_RANGES.adjectiveAdverbDensity
      ),
      sensitivity
    ),
    hedgingFrequency: applyDampening(
      scalarSimilarity(
        suggestion.hedgingFrequency,
        profile.hedgingFrequency,
        FEATURE_RANGES.hedgingFrequency
      ),
      sensitivity
    ),
    stopwordDensity: applyDampening(
      scalarSimilarity(
        suggestion.stopwordDensity,
        profile.stopwordDensity,
        FEATURE_RANGES.stopwordDensity
      ),
      sensitivity
    ),
    contractionFrequency: applyDampening(
      scalarSimilarity(
        suggestion.contractionFrequency,
        profile.contractionFrequency,
        FEATURE_RANGES.contractionFrequency
      ),
      sensitivity
    ),
    questionRatio: applyDampening(
      scalarSimilarity(
        suggestion.questionRatio,
        profile.questionRatio,
        FEATURE_RANGES.questionRatio
      ),
      sensitivity
    ),
    exclamationRatio: applyDampening(
      scalarSimilarity(
        suggestion.exclamationRatio,
        profile.exclamationRatio,
        FEATURE_RANGES.exclamationRatio
      ),
      sensitivity
    ),
    vocabularyRichness: applyDampening(
      scalarSimilarity(
        suggestion.vocabularyRichness,
        profile.vocabularyRichness,
        FEATURE_RANGES.vocabularyRichness
      ),
      sensitivity
    ),
    avgWordLength: applyDampening(
      scalarSimilarity(
        suggestion.avgWordLength,
        profile.avgWordLength,
        FEATURE_RANGES.avgWordLength
      ),
      sensitivity
    ),
    readabilityScore: applyDampening(
      scalarSimilarity(
        suggestion.readabilityScore,
        profile.readabilityScore,
        FEATURE_RANGES.readabilityScore
      ),
      sensitivity
    ),
    complexityScore: applyDampening(
      scalarSimilarity(
        suggestion.complexityScore,
        profile.complexityScore,
        FEATURE_RANGES.complexityScore
      ),
      sensitivity
    ),
    lexicalSignatureSimilarity: applyDampening(
      lexicalSignatureSimilarity(
        suggestion.lexicalSignature,
        profile.lexicalSignature
      ),
      sensitivity
    ),
  };

  let weighted = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(STYLISTIC_WEIGHTS)) {
    const score = scores[key];
    if (score !== undefined) {
      weighted += score * weight;
      totalWeight += weight;
    }
  }

  return totalWeight > 0 ? weighted / totalWeight : 1;
}

// ── Scope compliance scoring ─────────────────────────────────────────────────

type ScopeExpectations = {
  paragraphCountRatio: { min: number; max: number };
  sentenceCountRatio: { min: number; max: number };
  wordCountRatio: { min: number; max: number };
};

const SCOPE_EXPECTATIONS: Record<EditorialMode, ScopeExpectations> = {
  copy: {
    paragraphCountRatio: { min: 0.95, max: 1.05 },
    sentenceCountRatio: { min: 0.9, max: 1.1 },
    wordCountRatio: { min: 0.9, max: 1.1 },
  },
  line: {
    paragraphCountRatio: { min: 0.85, max: 1.15 },
    sentenceCountRatio: { min: 0.75, max: 1.25 },
    wordCountRatio: { min: 0.7, max: 1.15 },
  },
  developmental: {
    paragraphCountRatio: { min: 0.6, max: 1.6 },
    sentenceCountRatio: { min: 0.6, max: 1.6 },
    wordCountRatio: { min: 0.6, max: 1.4 },
  },
};

export function computeScopeScore(
  original: VoiceFingerprint,
  suggestion: VoiceFingerprint,
  mode: EditorialMode
): number {
  const expectations = SCOPE_EXPECTATIONS[mode];

  const ratios = {
    paragraphCountRatio: safeRatio(
      suggestion.paragraphCount,
      original.paragraphCount
    ),
    sentenceCountRatio: safeRatio(
      suggestion.sentenceCount,
      original.sentenceCount
    ),
    wordCountRatio: safeRatio(suggestion.wordCount, original.wordCount),
  };

  let totalScore = 0;
  let count = 0;

  for (const [key, ratio] of Object.entries(ratios)) {
    const range = expectations[key as keyof ScopeExpectations];
    totalScore += rangeScore(ratio, range.min, range.max);
    count++;
  }

  return count > 0 ? totalScore / count : 1;
}

function safeRatio(a: number, b: number): number {
  if (b === 0) return a === 0 ? 1 : 0;
  return a / b;
}

function rangeScore(value: number, min: number, max: number): number {
  if (value >= min && value <= max) return 1;
  const rangeWidth = max - min;
  if (value < min) {
    return Math.max(0, 1 - (min - value) / rangeWidth);
  }
  return Math.max(0, 1 - (value - max) / rangeWidth);
}

// ── Semantic scoring (heuristic component) ───────────────────────────────────

export function semanticHeuristicPenalty(
  original: string,
  suggestion: string
): number {
  let penalty = 1.0;

  const origWords = original.split(/\s+/).length;
  const sugWords = suggestion.split(/\s+/).length;
  const lengthRatio = origWords > 0 ? sugWords / origWords : 1;

  if (lengthRatio > 1.5 || lengthRatio < 0.5) {
    penalty *= 0.7;
  } else if (lengthRatio > 1.3 || lengthRatio < 0.7) {
    penalty *= 0.85;
  }

  return penalty;
}

// ── Combined scoring ─────────────────────────────────────────────────────────

// Tuned via calibration dataset (scripts/voice-calibration) — 100% good>bad accuracy
const MODE_WEIGHTS: Record<EditorialMode, ScoringWeights> = {
  copy: { semantic: 0.3, stylistic: 0.4, scope: 0.3 },
  line: { semantic: 0.2, stylistic: 0.65, scope: 0.15 },
  developmental: { semantic: 0.2, stylistic: 0.65, scope: 0.15 },
};

/**
 * Compute the combined voice identity score with optional
 * confidence-based weight modulation.
 *
 * At low confidence: semantic weight increases, stylistic decreases.
 * At high confidence: base mode weights apply.
 */
export function computeCombinedScore(
  scores: Omit<VoiceScores, "combinedScore">,
  mode: EditorialMode,
  profileConfidence?: number | null
): number {
  const baseWeights = MODE_WEIGHTS[mode];

  if (profileConfidence == null) {
    return (
      scores.semanticScore * baseWeights.semantic +
      scores.stylisticScore * baseWeights.stylistic +
      scores.scopeScore * baseWeights.scope
    );
  }

  const modulation = computeScoringModulation(profileConfidence);

  // Apply multipliers and renormalize to sum to 1
  const rawSemantic = baseWeights.semantic * modulation.semanticMultiplier;
  const rawStylistic = baseWeights.stylistic * modulation.stylisticMultiplier;
  const rawScope = baseWeights.scope * modulation.scopeMultiplier;
  const total = rawSemantic + rawStylistic + rawScope;

  return (
    scores.semanticScore * (rawSemantic / total) +
    scores.stylisticScore * (rawStylistic / total) +
    scores.scopeScore * (rawScope / total)
  );
}

export function getWeightsForMode(mode: EditorialMode): ScoringWeights {
  return MODE_WEIGHTS[mode];
}

export { cosineSimilarity };
