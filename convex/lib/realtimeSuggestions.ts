/**
 * Realtime suggestion modes — separate from full editorial passes.
 * Uses its own LLM variable for independent model selection and latency tuning.
 */

import type { VoiceFingerprint } from "./voiceTypes";

export type RealtimeSuggestionMode = "ghost_completion" | "inline_replacement";

/**
 * Model configuration for realtime suggestions.
 * Separate from editorial pass models — will likely use a faster/smaller model.
 */
export const REALTIME_MODEL_CONFIG = {
  ghost_completion: {
    temperature: 0.3,
    maxTokens: 120,
    /** Completions should feel natural, not overwrought */
    topP: 0.9,
  },
  inline_replacement: {
    temperature: 0.2,
    maxTokens: 40,
    /** Replacements should be precise and conservative */
    topP: 0.85,
  },
} as const;

/**
 * Confidence-based aggressiveness scaling.
 * Low confidence → conservative (minimal stylistic intervention).
 * High confidence → full voice-aware suggestions.
 */
export function computeAggressiveness(
  profileConfidence: number | null | undefined
): {
  level: "conservative" | "moderate" | "full";
  stylisticWeight: number;
  promptModifier: string;
} {
  const confidence = profileConfidence ?? 0;

  if (confidence < 0.4) {
    return {
      level: "conservative",
      stylisticWeight: 0.3,
      promptModifier:
        "Focus on clarity and correctness only. Do NOT alter the author's style, voice, or word choices. Suggest only when there is a clear improvement in readability or grammar.",
    };
  }

  if (confidence < 0.7) {
    return {
      level: "moderate",
      stylisticWeight: 0.6,
      promptModifier:
        "Suggest improvements that respect the author's established patterns. Modest tightening is acceptable. Do not impose a different voice.",
    };
  }

  return {
    level: "full",
    stylisticWeight: 1.0,
    promptModifier:
      "Match the author's voice precisely. Suggestions should sound like the author wrote them. Preserve their characteristic patterns, cadence, and word choices.",
  };
}

/**
 * Build the voice description block injected into realtime prompts.
 * Returns empty string if no profile exists (pre-calibration state).
 */
export function buildVoiceBlock(
  fingerprint: VoiceFingerprint | null | undefined
): string {
  if (!fingerprint) return "";

  const traits: string[] = [];

  // Sentence structure
  const avgLen = fingerprint.avgSentenceLength;
  if (avgLen < 12) traits.push("Short, punchy sentences");
  else if (avgLen < 20) traits.push("Medium-length sentences");
  else traits.push("Long, flowing sentences");

  // Contractions
  if (fingerprint.contractionFrequency > 0.15) {
    traits.push("Uses contractions frequently (informal tone)");
  } else if (fingerprint.contractionFrequency < 0.03) {
    traits.push("Avoids contractions (formal tone)");
  }

  // Hedging
  if (fingerprint.hedgingFrequency > 0.04) {
    traits.push("Tends to hedge and qualify statements");
  } else if (fingerprint.hedgingFrequency < 0.01) {
    traits.push("Direct and declarative");
  }

  // Punctuation patterns (schema uses "dash" not "emDash")
  const punct = fingerprint.punctuationFrequencies;
  if (punct?.dash && punct.dash > 0.01) {
    traits.push("Uses em dashes for asides");
  }
  if (punct?.semicolon && punct.semicolon > 0.005) {
    traits.push("Uses semicolons to connect related ideas");
  }
  if (punct?.exclamation && punct.exclamation > 0.02) {
    traits.push("Occasionally emphatic (exclamation marks)");
  }

  if (traits.length === 0) return "";

  return `\n\nAUTHOR VOICE PROFILE:\n${traits.map((t) => `- ${t}`).join("\n")}`;
}

/**
 * Ghost completion prompt — scoped to sentence/paragraph continuation.
 */
export function buildGhostCompletionPrompt(args: {
  textBefore: string;
  blockText: string;
  voiceBlock: string;
  aggressivenessModifier: string;
}): { system: string; user: string } {
  return {
    system: `You are a writing assistant that completes the author's current thought. You suggest what comes next — a phrase, clause, or sentence continuation.

RULES:
- Output ONLY the completion text. No commentary, no quotation marks, no prefixes.
- Continue naturally from exactly where the author stopped.
- Never repeat text the author has already written.
- Keep completions concise (1 clause or short sentence, max 2 sentences).
- Match the author's tone, register, and complexity level.
- If the sentence is complete, suggest the next logical sentence.
- If you have nothing confident to suggest, respond with exactly: NULL
${args.aggressivenessModifier ? `\n${args.aggressivenessModifier}` : ""}${args.voiceBlock}`,
    user: `Continue this text naturally. The cursor is at the end — suggest what comes next.

PARAGRAPH CONTEXT:
${args.blockText}

WRITE IMMEDIATELY AFTER:
${args.textBefore}`,
  };
}

/**
 * Inline replacement prompt — scoped to a single word within sentence context.
 */
export function buildReplacementPrompt(args: {
  word: string;
  sentence: string;
  blockText: string;
  voiceBlock: string;
  aggressivenessModifier: string;
}): { system: string; user: string } {
  return {
    system: `You are a precise line editor. You suggest single-word or short-phrase replacements that tighten prose.

RULES:
- Output ONLY a JSON object: {"replacement": "...", "reason": "..."}
- "replacement" is the suggested substitute (1-3 words max).
- "reason" is 2-4 words explaining why (e.g., "more precise", "tighter").
- Only suggest when there is a genuine improvement. Lateral moves are not improvements.
- Preserve the author's voice. Do not impose formality, informality, or a different register.
- If no improvement exists, respond with exactly: NULL
${args.aggressivenessModifier ? `\n${args.aggressivenessModifier}` : ""}${args.voiceBlock}`,
    user: `Consider replacing "${args.word}" in this sentence:

SENTENCE: ${args.sentence}

FULL PARAGRAPH: ${args.blockText}

Suggest a replacement ONLY if it genuinely improves the text. Otherwise respond NULL.`,
  };
}
