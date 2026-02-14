/**
 * Deterministic linguistic fingerprint extraction.
 *
 * Pure computation — no external dependencies, no network calls,
 * no randomness. The same input always produces the same output.
 *
 * All density/frequency metrics are normalized to per-word or
 * per-sentence ratios so texts of different lengths produce
 * comparable fingerprints.
 */

import type {
  VoiceFingerprint,
  PunctuationFrequencies,
  LexicalEntry,
} from "./voiceTypes";

// ── Constants ────────────────────────────────────────────────────────────────

const LEXICAL_SIGNATURE_SIZE = 30;

/**
 * Minimum word count for a fingerprint to be considered usable.
 * Below this, confidence drops sharply and metrics are unreliable.
 */
export const MIN_WORDS_FOR_FINGERPRINT = 50;

// Confidence scaling: reaches ~0.9 at 500 words, ~0.95 at 1000
const CONFIDENCE_HALF_LIFE = 300;

// ── Word lists ───────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an",
  "and", "any", "are", "aren't", "as", "at", "be", "because", "been",
  "before", "being", "below", "between", "both", "but", "by", "can't",
  "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't",
  "doing", "don't", "down", "during", "each", "few", "for", "from",
  "further", "get", "got", "had", "hadn't", "has", "hasn't", "have",
  "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here",
  "here's", "hers", "herself", "him", "himself", "his", "how", "how's",
  "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't",
  "it", "it's", "its", "itself", "just", "let's", "me", "might", "more",
  "most", "mustn't", "my", "myself", "no", "nor", "not", "of", "off",
  "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves",
  "out", "over", "own", "really", "same", "shan't", "she", "she'd",
  "she'll", "she's", "should", "shouldn't", "so", "some", "still", "such",
  "than", "that", "that's", "the", "their", "theirs", "them", "themselves",
  "then", "there", "there's", "these", "they", "they'd", "they'll",
  "they're", "they've", "this", "those", "through", "to", "too", "under",
  "until", "up", "us", "very", "was", "wasn't", "we", "we'd", "we'll",
  "we're", "we've", "were", "weren't", "what", "what's", "when", "when's",
  "where", "where's", "which", "while", "who", "who's", "whom", "why",
  "why's", "will", "with", "won't", "would", "wouldn't", "you", "you'd",
  "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves",
]);

const FUNCTION_WORDS = new Set([
  "the", "a", "an", "and", "but", "or", "nor", "for", "yet", "so",
  "in", "on", "at", "to", "from", "by", "with", "about", "into",
  "through", "during", "before", "after", "above", "below", "between",
  "under", "over", "of", "up", "down", "out", "off", "then", "than",
  "that", "this", "these", "those", "which", "who", "whom", "whose",
  "what", "where", "when", "how", "why", "if", "because", "since",
  "while", "although", "though", "unless", "until", "whether",
  "not", "no", "never", "always", "also", "just", "only", "even",
  "still", "already", "very", "quite", "rather", "really", "too",
  "much", "more", "most", "less", "least", "well", "almost", "enough",
  "perhaps", "maybe", "however", "therefore", "thus", "hence",
  "nevertheless", "meanwhile", "otherwise", "instead", "indeed",
  "certainly", "probably", "possibly", "actually", "apparently",
  "basically", "essentially", "generally", "particularly", "specifically",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her",
  "us", "them", "my", "your", "his", "its", "our", "their",
  "myself", "yourself", "himself", "herself", "itself", "ourselves",
  "themselves",
  "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "having",
  "do", "does", "did", "doing",
  "will", "would", "shall", "should", "may", "might", "can", "could",
  "must", "need", "ought",
]);

const HEDGING_PHRASES = [
  "i think", "i believe", "i feel", "i guess", "i suppose",
  "in my opinion", "it seems", "it appears", "it looks like",
  "kind of", "sort of", "somewhat", "relatively",
  "perhaps", "maybe", "possibly", "probably", "arguably",
  "might be", "could be", "may be", "seems to be",
  "to some extent", "in some ways", "more or less",
  "a bit", "a little", "slightly", "fairly", "rather",
  "tend to", "seems like", "appears to",
  "not entirely", "not necessarily", "not always",
];

const ADJECTIVE_SUFFIXES = [
  "able", "ible", "al", "ial", "ful", "ic", "ical", "ish",
  "ive", "less", "ous", "ious", "eous",
];

const COMMON_ADJECTIVES = new Set([
  "good", "bad", "big", "small", "large", "great", "little", "old",
  "new", "young", "long", "short", "high", "low", "early", "late",
  "hard", "soft", "hot", "cold", "fast", "slow", "full", "empty",
  "dark", "light", "clear", "strong", "weak", "deep", "wide", "thin",
  "thick", "flat", "sharp", "smooth", "rough", "clean", "dirty",
  "simple", "complex", "easy", "difficult", "sure", "certain",
  "real", "true", "false", "right", "wrong", "whole", "entire",
  "main", "key", "major", "minor", "common", "rare", "strange",
  "weird", "obvious", "subtle", "specific", "broad", "narrow",
]);

const COMMON_ADVERBS = new Set([
  "very", "really", "quite", "rather", "fairly", "pretty",
  "just", "only", "even", "still", "already", "always", "never",
  "often", "sometimes", "usually", "rarely", "seldom",
  "here", "there", "now", "then", "today", "tomorrow", "yesterday",
  "soon", "later", "again", "also", "too", "well", "badly",
  "hard", "fast", "far", "near", "long", "enough",
]);

const CONTRACTION_PATTERN = /\b\w+'(?:t|s|re|ve|ll|d|m)\b/gi;

// ── Text parsing utilities ───────────────────────────────────────────────────

function splitSentences(text: string): string[] {
  const raw = text
    .replace(/([.!?…])(\s+|$)/g, "$1\n")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const merged: string[] = [];
  for (const s of raw) {
    if (
      merged.length > 0 &&
      merged[merged.length - 1].length < 15 &&
      !merged[merged.length - 1].match(/[.!?…]$/)
    ) {
      merged[merged.length - 1] += " " + s;
    } else {
      merged.push(s);
    }
  }
  return merged;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 2) return 1;

  let count = 0;
  let prevVowel = false;
  const vowels = new Set(["a", "e", "i", "o", "u", "y"]);

  for (let i = 0; i < w.length; i++) {
    const isVowel = vowels.has(w[i]);
    if (isVowel && !prevVowel) count++;
    prevVowel = isVowel;
  }

  if (w.endsWith("e") && !w.endsWith("le") && count > 1) count--;
  if (w.endsWith("ed") && w.length > 3 && count > 1) count--;

  return Math.max(1, count);
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sumSq = values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
  return sumSq / values.length;
}

function isAdjective(word: string): boolean {
  if (COMMON_ADJECTIVES.has(word)) return true;
  return ADJECTIVE_SUFFIXES.some(
    (suffix) => word.endsWith(suffix) && word.length > suffix.length + 2
  );
}

function isAdverb(word: string): boolean {
  if (COMMON_ADVERBS.has(word)) return true;
  return word.endsWith("ly") && word.length > 4;
}

// ── Main extraction ──────────────────────────────────────────────────────────

export function extractFingerprint(text: string): VoiceFingerprint {
  const paragraphs = splitParagraphs(text);
  const sentences = splitSentences(text);
  const words = tokenize(text);
  const wordCount = words.length;
  const sentenceCount = Math.max(sentences.length, 1);
  const paragraphCount = Math.max(paragraphs.length, 1);

  const confidence =
    wordCount < MIN_WORDS_FOR_FINGERPRINT
      ? (wordCount / MIN_WORDS_FOR_FINGERPRINT) * 0.5
      : 1 - Math.exp(-wordCount / CONFIDENCE_HALF_LIFE);

  const sentenceWordCounts = sentences.map((s) => tokenize(s).length);
  const avgSentenceLength =
    sentenceWordCounts.reduce((a, b) => a + b, 0) / sentenceCount;
  const sentenceLengthVariance = variance(sentenceWordCounts);
  const sentenceLengthStdDev = Math.sqrt(sentenceLengthVariance);

  const paragraphSentenceCounts = paragraphs.map((p) =>
    splitSentences(p).length
  );
  const avgParagraphLength =
    paragraphSentenceCounts.reduce((a, b) => a + b, 0) / paragraphCount;
  const paragraphLengthVariance = variance(paragraphSentenceCounts);

  const per1k = wordCount > 0 ? 1000 / wordCount : 0;
  const punctuationFrequencies: PunctuationFrequencies = {
    comma: (text.match(/,/g)?.length ?? 0) * per1k,
    period: (text.match(/\./g)?.length ?? 0) * per1k,
    semicolon: (text.match(/;/g)?.length ?? 0) * per1k,
    colon: (text.match(/:/g)?.length ?? 0) * per1k,
    exclamation: (text.match(/!/g)?.length ?? 0) * per1k,
    question: (text.match(/\?/g)?.length ?? 0) * per1k,
    dash: (text.match(/[—–-]{1,2}/g)?.length ?? 0) * per1k,
    ellipsis: (text.match(/\.{3}|…/g)?.length ?? 0) * per1k,
    parenthetical: (text.match(/[()]/g)?.length ?? 0) * per1k,
  };

  let adjAdvCount = 0;
  for (const w of words) {
    if (isAdjective(w) || isAdverb(w)) adjAdvCount++;
  }
  const adjectiveAdverbDensity = wordCount > 0 ? adjAdvCount / wordCount : 0;

  const lowerText = text.toLowerCase();
  let hedgeCount = 0;
  for (const phrase of HEDGING_PHRASES) {
    let idx = 0;
    while ((idx = lowerText.indexOf(phrase, idx)) !== -1) {
      hedgeCount++;
      idx += phrase.length;
    }
  }
  const hedgingFrequency = sentenceCount > 0 ? hedgeCount / sentenceCount : 0;

  let stopCount = 0;
  for (const w of words) {
    if (STOPWORDS.has(w)) stopCount++;
  }
  const stopwordDensity = wordCount > 0 ? stopCount / wordCount : 0;

  const contractions = text.match(CONTRACTION_PATTERN) ?? [];
  const contractionFrequency =
    wordCount > 0 ? contractions.length / wordCount : 0;

  let questionCount = 0;
  let exclamationCount = 0;
  for (const s of sentences) {
    if (s.endsWith("?")) questionCount++;
    if (s.endsWith("!")) exclamationCount++;
  }
  const questionRatio = sentenceCount > 0 ? questionCount / sentenceCount : 0;
  const exclamationRatio =
    sentenceCount > 0 ? exclamationCount / sentenceCount : 0;

  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(words[i] + " " + words[i + 1]);
  }
  const uniqueBigrams = new Set(bigrams);
  const repetitionIndex =
    bigrams.length > 0 ? 1 - uniqueBigrams.size / bigrams.length : 0;

  const uniqueWords = new Set(words);
  const vocabularyRichness = wordCount > 0 ? uniqueWords.size / wordCount : 0;

  const totalChars = words.reduce((acc, w) => acc + w.length, 0);
  const avgWordLength = wordCount > 0 ? totalChars / wordCount : 0;

  const totalSyllables = words.reduce(
    (acc, w) => acc + countSyllables(w),
    0
  );
  const avgSyllablesPerWord =
    wordCount > 0 ? totalSyllables / wordCount : 0;
  const readabilityScore =
    0.39 * avgSentenceLength + 11.8 * avgSyllablesPerWord - 15.59;
  const complexityScore = avgSyllablesPerWord;

  const functionWordCounts = new Map<string, number>();
  for (const w of words) {
    if (FUNCTION_WORDS.has(w)) {
      functionWordCounts.set(w, (functionWordCounts.get(w) ?? 0) + 1);
    }
  }
  const lexicalSignature: LexicalEntry[] = [...functionWordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, LEXICAL_SIGNATURE_SIZE)
    .map(([word, count]) => ({
      word,
      frequency: wordCount > 0 ? count / wordCount : 0,
    }));

  return {
    avgSentenceLength,
    sentenceLengthVariance,
    sentenceLengthStdDev,
    avgParagraphLength,
    paragraphLengthVariance,
    punctuationFrequencies,
    adjectiveAdverbDensity,
    hedgingFrequency,
    stopwordDensity,
    contractionFrequency,
    questionRatio,
    exclamationRatio,
    repetitionIndex,
    vocabularyRichness,
    avgWordLength,
    readabilityScore,
    complexityScore,
    lexicalSignature,
    wordCount,
    sentenceCount,
    paragraphCount,
    confidence,
  };
}

// ── Evolution constants ──────────────────────────────────────────────────

/**
 * Absolute alpha bounds. These are non-negotiable — no code path
 * may produce an alpha outside this range.
 */
const ALPHA_MIN = 0.05;
const ALPHA_MAX = 0.25;

/**
 * If a new sample's word count exceeds this multiple of the profile's
 * average sample word count, cap the alpha further. Prevents a single
 * massive text dump from overwhelming the profile.
 */
const WORD_COUNT_RATIO_CAP = 3.0;

/**
 * Alpha reduction factor when word count ratio exceeds the cap.
 * Applied multiplicatively: effective_alpha = base_alpha * RATIO_PENALTY
 */
const WORD_COUNT_RATIO_PENALTY = 0.6;

/**
 * If the profile hasn't been updated in this many milliseconds,
 * allow a slightly higher alpha to let the profile evolve.
 * 30 days in ms.
 */
const STALENESS_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Maximum alpha boost for stale profiles. Added to the base alpha
 * (still bounded by ALPHA_MAX).
 */
const STALENESS_ALPHA_BOOST = 0.05;

export type AlphaDetails = {
  rawAlpha: number;
  boundedAlpha: number;
  wordCountRatio: number;
  wordCountPenaltyApplied: boolean;
  stalenessBoostApplied: boolean;
  finalAlpha: number;
};

/**
 * Blend a new fingerprint into an existing profile using bounded
 * exponential decay with hardened safety guards.
 *
 * Guarantees:
 *  1. Alpha is always in [ALPHA_MIN, ALPHA_MAX]
 *  2. Single large samples are penalized via word count ratio cap
 *  3. Stale profiles allow slightly faster evolution
 *  4. The existing profile always retains at least (1 - ALPHA_MAX) = 75%
 *  5. Every blend is deterministic: same inputs → same output
 *
 * @param existing       Current profile fingerprint
 * @param incoming       New sample fingerprint
 * @param sampleCount    Current sample count BEFORE this contribution
 * @param avgSampleWords Average word count per sample in the profile
 * @param lastSampleAt   Timestamp of the most recent prior sample
 * @param now            Current timestamp
 */
export function blendFingerprints(
  existing: VoiceFingerprint,
  incoming: VoiceFingerprint,
  sampleCount: number,
  avgSampleWords: number,
  lastSampleAt: number,
  now: number
): { blended: VoiceFingerprint; alpha: number; alphaDetails: AlphaDetails } {
  // ── Compute base alpha ───────────────────────────────────
  const rawAlpha = 1 / (sampleCount + 1);
  let alpha = Math.max(ALPHA_MIN, Math.min(ALPHA_MAX, rawAlpha));

  const details: AlphaDetails = {
    rawAlpha,
    boundedAlpha: alpha,
    wordCountRatio: 0,
    wordCountPenaltyApplied: false,
    stalenessBoostApplied: false,
    finalAlpha: alpha,
  };

  // ── Word count ratio penalty ─────────────────────────────
  if (avgSampleWords > 0 && incoming.wordCount > 0) {
    const ratio = incoming.wordCount / avgSampleWords;
    details.wordCountRatio = ratio;
    if (ratio > WORD_COUNT_RATIO_CAP) {
      alpha = alpha * WORD_COUNT_RATIO_PENALTY;
      alpha = Math.max(ALPHA_MIN, alpha); // Never below floor
      details.wordCountPenaltyApplied = true;
    }
  }

  // ── Staleness boost ──────────────────────────────────────
  if (lastSampleAt > 0) {
    const elapsed = now - lastSampleAt;
    if (elapsed > STALENESS_THRESHOLD_MS) {
      const boostFraction = Math.min(
        1,
        elapsed / (STALENESS_THRESHOLD_MS * 3)
      );
      alpha = Math.min(ALPHA_MAX, alpha + STALENESS_ALPHA_BOOST * boostFraction);
      details.stalenessBoostApplied = true;
    }
  }

  details.finalAlpha = alpha;

  // ── Blend scalar metrics ─────────────────────────────────
  const blend = (a: number, b: number): number =>
    a * (1 - alpha) + b * alpha;

  const pf: PunctuationFrequencies = {
    comma: blend(existing.punctuationFrequencies.comma, incoming.punctuationFrequencies.comma),
    period: blend(existing.punctuationFrequencies.period, incoming.punctuationFrequencies.period),
    semicolon: blend(existing.punctuationFrequencies.semicolon, incoming.punctuationFrequencies.semicolon),
    colon: blend(existing.punctuationFrequencies.colon, incoming.punctuationFrequencies.colon),
    exclamation: blend(existing.punctuationFrequencies.exclamation, incoming.punctuationFrequencies.exclamation),
    question: blend(existing.punctuationFrequencies.question, incoming.punctuationFrequencies.question),
    dash: blend(existing.punctuationFrequencies.dash, incoming.punctuationFrequencies.dash),
    ellipsis: blend(existing.punctuationFrequencies.ellipsis, incoming.punctuationFrequencies.ellipsis),
    parenthetical: blend(existing.punctuationFrequencies.parenthetical, incoming.punctuationFrequencies.parenthetical),
  };

  // ── Blend lexical signature ──────────────────────────────
  const lexMap = new Map<string, number>();
  for (const entry of existing.lexicalSignature) {
    lexMap.set(entry.word, entry.frequency * (1 - alpha));
  }
  for (const entry of incoming.lexicalSignature) {
    const current = lexMap.get(entry.word) ?? 0;
    lexMap.set(entry.word, current + entry.frequency * alpha);
  }
  const lexicalSignature = [...lexMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, LEXICAL_SIGNATURE_SIZE)
    .map(([word, frequency]) => ({ word, frequency }));

  const blended: VoiceFingerprint = {
    avgSentenceLength: blend(existing.avgSentenceLength, incoming.avgSentenceLength),
    sentenceLengthVariance: blend(existing.sentenceLengthVariance, incoming.sentenceLengthVariance),
    sentenceLengthStdDev: blend(existing.sentenceLengthStdDev, incoming.sentenceLengthStdDev),
    avgParagraphLength: blend(existing.avgParagraphLength, incoming.avgParagraphLength),
    paragraphLengthVariance: blend(existing.paragraphLengthVariance, incoming.paragraphLengthVariance),
    punctuationFrequencies: pf,
    adjectiveAdverbDensity: blend(existing.adjectiveAdverbDensity, incoming.adjectiveAdverbDensity),
    hedgingFrequency: blend(existing.hedgingFrequency, incoming.hedgingFrequency),
    stopwordDensity: blend(existing.stopwordDensity, incoming.stopwordDensity),
    contractionFrequency: blend(existing.contractionFrequency, incoming.contractionFrequency),
    questionRatio: blend(existing.questionRatio, incoming.questionRatio),
    exclamationRatio: blend(existing.exclamationRatio, incoming.exclamationRatio),
    repetitionIndex: blend(existing.repetitionIndex, incoming.repetitionIndex),
    vocabularyRichness: blend(existing.vocabularyRichness, incoming.vocabularyRichness),
    avgWordLength: blend(existing.avgWordLength, incoming.avgWordLength),
    readabilityScore: blend(existing.readabilityScore, incoming.readabilityScore),
    complexityScore: blend(existing.complexityScore, incoming.complexityScore),
    lexicalSignature,
    wordCount: existing.wordCount + incoming.wordCount,
    sentenceCount: existing.sentenceCount + incoming.sentenceCount,
    paragraphCount: existing.paragraphCount + incoming.paragraphCount,
    confidence: Math.min(1, existing.confidence + incoming.confidence * alpha),
  };

  return { blended, alpha: details.finalAlpha, alphaDetails: details };
}
