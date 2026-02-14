/**
 * Internal explainability layer — metric influence breakdown per run.
 *
 * For every refinement run, computes which metrics most influenced
 * the final score: cadence delta, punctuation shift, lexical density
 * shift, semantic delta, constraint violation flags.
 *
 * Enables targeted tuning instead of blind weight adjustment.
 */

import type {
  VoiceFingerprint,
  PunctuationFrequencies,
  EditorialMode,
} from "./voiceTypes";

// Re-export FEATURE_RANGES and STYLISTIC_WEIGHTS structure for breakdown
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
  const keys = Object.keys(a) as (keyof PunctuationFrequencies)[];
  const vecA = keys.map((k) => a[k]);
  const vecB = keys.map((k) => b[k]);
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

export type MetricInfluence = {
  metric: string;
  rawScore: number;
  weight: number;
  contribution: number;
};

export type ExplainabilityResult = {
  cadenceDelta: number;
  punctuationDelta: number;
  lexicalDensityDelta: number;
  semanticDelta: number;
  constraintViolations: string[];
  topNegativeInfluences: MetricInfluence[];
  topPositiveInfluences: MetricInfluence[];
};

/**
 * Compute which metrics most influenced the final score for a run.
 *
 * Cadence = sentence length similarity (1 = perfect, 0 = max drift)
 * Punctuation = punctuation similarity
 * Lexical density = vocabulary richness similarity
 * Semantic = semantic preservation score (already computed)
 */
export function computeMetricInfluences(
  original: VoiceFingerprint,
  suggestion: VoiceFingerprint,
  profile: VoiceFingerprint,
  semanticScore: number,
  enforcementClass: string,
  _mode: EditorialMode
): ExplainabilityResult {
  const target = profile;

  const rawScores: Record<string, number> = {
    avgSentenceLength: scalarSimilarity(
      suggestion.avgSentenceLength,
      target.avgSentenceLength,
      FEATURE_RANGES.avgSentenceLength
    ),
    sentenceLengthStdDev: scalarSimilarity(
      suggestion.sentenceLengthStdDev,
      target.sentenceLengthStdDev,
      FEATURE_RANGES.sentenceLengthStdDev
    ),
    avgParagraphLength: scalarSimilarity(
      suggestion.avgParagraphLength,
      target.avgParagraphLength,
      FEATURE_RANGES.avgParagraphLength
    ),
    punctuationSimilarity: punctuationSimilarity(
      suggestion.punctuationFrequencies,
      target.punctuationFrequencies
    ),
    adjectiveAdverbDensity: scalarSimilarity(
      suggestion.adjectiveAdverbDensity,
      target.adjectiveAdverbDensity,
      FEATURE_RANGES.adjectiveAdverbDensity
    ),
    hedgingFrequency: scalarSimilarity(
      suggestion.hedgingFrequency,
      target.hedgingFrequency,
      FEATURE_RANGES.hedgingFrequency
    ),
    stopwordDensity: scalarSimilarity(
      suggestion.stopwordDensity,
      target.stopwordDensity,
      FEATURE_RANGES.stopwordDensity
    ),
    contractionFrequency: scalarSimilarity(
      suggestion.contractionFrequency,
      target.contractionFrequency,
      FEATURE_RANGES.contractionFrequency
    ),
    questionRatio: scalarSimilarity(
      suggestion.questionRatio,
      target.questionRatio,
      FEATURE_RANGES.questionRatio
    ),
    exclamationRatio: scalarSimilarity(
      suggestion.exclamationRatio,
      target.exclamationRatio,
      FEATURE_RANGES.exclamationRatio
    ),
    vocabularyRichness: scalarSimilarity(
      suggestion.vocabularyRichness,
      target.vocabularyRichness,
      FEATURE_RANGES.vocabularyRichness
    ),
    avgWordLength: scalarSimilarity(
      suggestion.avgWordLength,
      target.avgWordLength,
      FEATURE_RANGES.avgWordLength
    ),
    readabilityScore: scalarSimilarity(
      suggestion.readabilityScore,
      target.readabilityScore,
      FEATURE_RANGES.readabilityScore
    ),
    complexityScore: scalarSimilarity(
      suggestion.complexityScore,
      target.complexityScore,
      FEATURE_RANGES.complexityScore
    ),
    lexicalSignatureSimilarity: lexicalSignatureSimilarity(
      suggestion.lexicalSignature,
      target.lexicalSignature
    ),
  };

  const influences: MetricInfluence[] = [];
  for (const [metric, weight] of Object.entries(STYLISTIC_WEIGHTS)) {
    const raw = rawScores[metric];
    if (raw !== undefined) {
      influences.push({
        metric,
        rawScore: raw,
        weight,
        contribution: raw * weight,
      });
    }
  }

  influences.sort((a, b) => a.contribution - b.contribution);
  const topNegative = influences.slice(0, 5);
  const topPositive = influences.slice(-5).reverse();

  const cadenceSim =
    (rawScores.avgSentenceLength ?? 1) *
    (rawScores.sentenceLengthStdDev ?? 1) *
    (rawScores.avgParagraphLength ?? 1);
  const cadenceDelta = 1 - cadenceSim;

  const punctuationDelta = 1 - (rawScores.punctuationSimilarity ?? 1);

  const lexicalDensityDelta =
    1 - (rawScores.vocabularyRichness ?? 1);

  const semanticDelta = 1 - semanticScore;

  const constraintViolations: string[] = [];
  if (enforcementClass === "drift") {
    constraintViolations.push("semantic_drift");
  }
  if (enforcementClass === "failure") {
    constraintViolations.push("combined_below_threshold");
  }
  if (enforcementClass === "soft_warning") {
    constraintViolations.push("stylistic_drift");
  }

  return {
    cadenceDelta,
    punctuationDelta,
    lexicalDensityDelta,
    semanticDelta,
    constraintViolations,
    topNegativeInfluences: topNegative,
    topPositiveInfluences: topPositive,
  };
}
