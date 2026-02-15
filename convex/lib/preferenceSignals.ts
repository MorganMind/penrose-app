/**
 * Preference signal extraction and aggregation.
 *
 * Apply/Reject/Hunk toggles produce bounded nudges (e.g. "prefers shorter
 * sentences," "prefers fewer hedges"). These do NOT mutate the voice profile.
 * They influence generation parameters and candidate selection slightly.
 * Voice score remains the hard constraint.
 */

import { extractFingerprint } from "./voiceFingerprint";

// ── Constants ────────────────────────────────────────────────────────────────

/** Max magnitude per signal — preferences cannot push into a new voice. */
export const MAX_SIGNAL_MAGNITUDE = 0.05;

/** Decay half-life in ms (30 days). */
export const DECAY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

/** Min word count to extract meaningful preference deltas. */
const MIN_WORDS_FOR_PREFERENCE = 20;

/** Dimensions we track. Value: +1 = prefer more, -1 = prefer less. */
export type PreferenceDimension =
  | "sentence_length" // + = shorter, - = longer
  | "tightness" // + = fewer words, - = more words
  | "hedging" // + = fewer hedges, - = more hedges
  | "contractions" // + = more contractions, - = fewer
  | "complexity" // + = simpler (lower readability), - = denser
  | "punctuation"; // + = more varied punctuation, - = less

export type PreferenceSignal = {
  dimension: PreferenceDimension;
  value: number; // -1 to 1
  magnitude: number; // 0 to MAX_SIGNAL_MAGNITUDE
};

// ── Extraction ──────────────────────────────────────────────────────────────

/**
 * Extract preference signals from the delta between original and applied text.
 *
 * Apply: user preferred the applied text → positive value = applied moved in
 *        that direction (e.g. shorter sentences → sentence_length +)
 * Reject: user rejected the suggestion → negative value
 */
export function extractPreferenceSignals(
  originalText: string,
  appliedText: string,
  source: "apply" | "reject" | "hunk_apply"
): PreferenceSignal[] {
  const origFp = extractFingerprint(originalText);
  const appFp = extractFingerprint(appliedText);

  if (
    origFp.wordCount < MIN_WORDS_FOR_PREFERENCE ||
    appFp.wordCount < MIN_WORDS_FOR_PREFERENCE
  ) {
    return [];
  }

  const sign = source === "reject" ? -1 : 1;
  const signals: PreferenceSignal[] = [];

  // Sentence length: applied shorter → + (prefer shorter)
  const sentDelta = origFp.avgSentenceLength - appFp.avgSentenceLength;
  if (Math.abs(sentDelta) > 1) {
    const raw = Math.max(-1, Math.min(1, sentDelta / 10));
    signals.push({
      dimension: "sentence_length",
      value: sign * raw,
      magnitude: Math.min(
        MAX_SIGNAL_MAGNITUDE,
        (Math.abs(raw) * MAX_SIGNAL_MAGNITUDE) / 2
      ),
    });
  }

  // Tightness: word count ratio (applied fewer words → +)
  const wordRatio = appFp.wordCount / Math.max(1, origFp.wordCount);
  if (Math.abs(wordRatio - 1) > 0.05) {
    const raw = 1 - wordRatio; // fewer words = positive
    signals.push({
      dimension: "tightness",
      value: sign * Math.max(-1, Math.min(1, raw * 5)),
      magnitude: Math.min(
        MAX_SIGNAL_MAGNITUDE,
        Math.abs(raw) * MAX_SIGNAL_MAGNITUDE
      ),
    });
  }

  // Hedging: applied has fewer hedges → +
  const hedgeDelta = origFp.hedgingFrequency - appFp.hedgingFrequency;
  if (Math.abs(hedgeDelta) > 0.02) {
    const raw = Math.max(-1, Math.min(1, hedgeDelta * 20));
    signals.push({
      dimension: "hedging",
      value: sign * raw,
      magnitude: Math.min(
        MAX_SIGNAL_MAGNITUDE,
        (Math.abs(raw) * MAX_SIGNAL_MAGNITUDE) / 2
      ),
    });
  }

  // Contractions: applied has more → +
  const contDelta = appFp.contractionFrequency - origFp.contractionFrequency;
  if (Math.abs(contDelta) > 0.005) {
    const raw = Math.max(-1, Math.min(1, contDelta * 50));
    signals.push({
      dimension: "contractions",
      value: sign * raw,
      magnitude: Math.min(
        MAX_SIGNAL_MAGNITUDE,
        (Math.abs(raw) * MAX_SIGNAL_MAGNITUDE) / 2
      ),
    });
  }

  // Complexity (readability): applied simpler → +
  const readDelta = origFp.readabilityScore - appFp.readabilityScore;
  if (Math.abs(readDelta) > 0.5) {
    const raw = Math.max(-1, Math.min(1, readDelta / 5));
    signals.push({
      dimension: "complexity",
      value: sign * raw,
      magnitude: Math.min(
        MAX_SIGNAL_MAGNITUDE,
        (Math.abs(raw) * MAX_SIGNAL_MAGNITUDE) / 2
      ),
    });
  }

  return signals;
}

// ── Aggregation with decay ───────────────────────────────────────────────────

export type AggregatedPreferences = {
  sentence_length: number;
  tightness: number;
  hedging: number;
  contractions: number;
  complexity: number;
  punctuation: number;
  confidence: number; // 0–1, scales with sample count and recency
};

const DIMENSION_KEYS: PreferenceDimension[] = [
  "sentence_length",
  "tightness",
  "hedging",
  "contractions",
  "complexity",
  "punctuation",
];

/**
 * Aggregate signals with exponential decay.
 * Older signals contribute less. Result is clamped to [-1, 1] per dimension.
 */
export function aggregateSignals(
  signals: Array<{
    dimension: string;
    value: number;
    magnitude: number;
    createdAt: number;
  }>,
  now: number = Date.now()
): AggregatedPreferences {
  const result: AggregatedPreferences = {
    sentence_length: 0,
    tightness: 0,
    hedging: 0,
    contractions: 0,
    complexity: 0,
    punctuation: 0,
    confidence: 0,
  };

  const dimWeights: Record<string, number> = {};
  for (const key of DIMENSION_KEYS) dimWeights[key] = 0;

  for (const s of signals) {
    if (!DIMENSION_KEYS.includes(s.dimension as PreferenceDimension)) continue;

    const age = now - s.createdAt;
    const decay = Math.pow(0.5, age / DECAY_HALF_LIFE_MS);
    const weight = s.magnitude * decay;
    const key = s.dimension as keyof Omit<
      AggregatedPreferences,
      "confidence"
    >;
    if (key in result) {
      (result as Record<string, number>)[key] += s.value * weight;
      dimWeights[key] += weight;
    }
  }

  // Normalize per dimension and clamp
  for (const key of DIMENSION_KEYS) {
    const val = result[key as keyof AggregatedPreferences];
    const w = dimWeights[key];
    result[key as keyof AggregatedPreferences] = Math.max(
      -1,
      Math.min(1, w > 0 ? val / w : 0)
    );
  }

  // Confidence: more recent + more signals = higher
  const recentCount = signals.filter(
    (s) => now - s.createdAt < 7 * 24 * 60 * 60 * 1000
  ).length;
  result.confidence = Math.min(
    1,
    (signals.length / 10) * 0.5 + (recentCount / 5) * 0.5
  );

  return result;
}

// ── Prompt augmentation ──────────────────────────────────────────────────────

/**
 * Build a prompt suffix from aggregated preferences.
 * Only added when confidence is above threshold. Kept minimal so it
 * doesn't override voice constraints.
 */
export function buildPreferencePromptSuffix(
  prefs: AggregatedPreferences,
  minConfidence: number = 0.3
): string {
  if (prefs.confidence < minConfidence) return "";

  const parts: string[] = [];

  if (Math.abs(prefs.sentence_length) > 0.2) {
    parts.push(
      prefs.sentence_length > 0
        ? "Slightly prefer shorter sentences when two options are equally good."
        : "Slightly prefer longer, more flowing sentences when two options are equally good."
    );
  }
  if (Math.abs(prefs.hedging) > 0.2) {
    parts.push(
      prefs.hedging > 0
        ? "Slightly prefer fewer hedging phrases (e.g. 'perhaps', 'maybe') when two options are equally good."
        : "Slightly prefer retaining hedging and qualifiers when two options are equally good."
    );
  }
  if (Math.abs(prefs.contractions) > 0.2) {
    parts.push(
      prefs.contractions > 0
        ? "Slightly prefer contractions when two options are equally good."
        : "Slightly prefer avoiding contractions when two options are equally good."
    );
  }
  if (Math.abs(prefs.tightness) > 0.2) {
    parts.push(
      prefs.tightness > 0
        ? "Slightly prefer tighter, more concise phrasing when two options are equally good."
        : "Slightly prefer more expansive phrasing when two options are equally good."
    );
  }

  if (parts.length === 0) return "";

  return `

SUBTLE PREFERENCE HINTS (apply only when two options are equally good — voice preservation is the hard constraint):
${parts.join(" ")}`;
}
