/**
 * Shared types for the Voice Identity Engine.
 *
 * These mirror the schema validators but as TypeScript types
 * for use in pure computation functions.
 */

export type PunctuationFrequencies = {
  comma: number;
  period: number;
  semicolon: number;
  colon: number;
  exclamation: number;
  question: number;
  dash: number;
  ellipsis: number;
  parenthetical: number;
};

export type LexicalEntry = {
  word: string;
  frequency: number;
};

export type VoiceFingerprint = {
  avgSentenceLength: number;
  sentenceLengthVariance: number;
  sentenceLengthStdDev: number;
  avgParagraphLength: number;
  paragraphLengthVariance: number;
  punctuationFrequencies: PunctuationFrequencies;
  adjectiveAdverbDensity: number;
  hedgingFrequency: number;
  stopwordDensity: number;
  contractionFrequency: number;
  questionRatio: number;
  exclamationRatio: number;
  repetitionIndex: number;
  vocabularyRichness: number;
  avgWordLength: number;
  readabilityScore: number;
  complexityScore: number;
  lexicalSignature: LexicalEntry[];
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  confidence: number;
};

export type VoiceScores = {
  semanticScore: number;
  stylisticScore: number;
  scopeScore: number;
  combinedScore: number;
};

export type VoiceThresholds = {
  semantic: number;
  stylistic: number;
  scope: number;
  combined: number;
};

export type ScoringWeights = {
  semantic: number;
  stylistic: number;
  scope: number;
};

export type EditorialMode = "developmental" | "line" | "copy";

export type CorrectionType =
  | "constraint_boost"
  | "minimal_edit"
  | "passthrough";

export type ConfidenceBand = "low" | "medium" | "high";

export type EvaluationResult = {
  scores: VoiceScores;
  thresholds: VoiceThresholds;
  passed: boolean;
  enforced: boolean;
  profileStatus: "none" | "building" | "active";
  originalFingerprint: VoiceFingerprint;
  suggestionFingerprint: VoiceFingerprint;
  profileFingerprint: VoiceFingerprint | null;
  profileConfidence: number | null;
  profileConfidenceBand: ConfidenceBand | null;
};
