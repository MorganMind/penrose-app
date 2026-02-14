/**
 * Directional nudge definitions for the "Try again" variant system.
 *
 * Each nudge is a one-time directional instruction appended to the
 * editorial mode prompt. Nudges are ephemeral — they do not alter
 * the tenant's voice profile. Over time, selection patterns feed
 * into preference signal accumulation.
 */

export type NudgeDirection =
  | "more_minimal"
  | "more_raw"
  | "sharper"
  | "softer"
  | "more_emotional"
  | "more_dry";

export type NudgeConfig = {
  label: string;
  instruction: string;
};

export const NUDGE_DIRECTIONS: Record<NudgeDirection, NudgeConfig> = {
  more_minimal: {
    label: "More minimal",
    instruction:
      "Make the text more minimal and stripped down. Remove more unnecessary words, ornamentation, and decorative language. Favor brevity over explanation.",
  },
  more_raw: {
    label: "More raw",
    instruction:
      "Make the text feel more raw and unpolished. Preserve rough edges, imperfections, and directness that give it authentic character. Resist the urge to smooth everything out.",
  },
  sharper: {
    label: "Sharper",
    instruction:
      "Make the text sharper and more incisive. Strengthen the points, tighten the language, and make claims hit harder. Remove hedging and qualifiers where the author's intent is clear.",
  },
  softer: {
    label: "Softer",
    instruction:
      "Make the text softer and more approachable. Ease aggressive or confrontational language without losing the underlying point. Allow more breathing room between ideas.",
  },
  more_emotional: {
    label: "More emotional",
    instruction:
      "Let more emotion come through in the text. Do not manufacture emotion, but amplify what is already present. Let vulnerability, conviction, or passion show more clearly.",
  },
  more_dry: {
    label: "More dry",
    instruction:
      "Make the text drier and more matter-of-fact. Reduce emotionality, sentimentality, and ornamental language. Favor precision and understatement.",
  },
} as const;

export const NUDGE_DIRECTION_KEYS = Object.keys(
  NUDGE_DIRECTIONS
) as NudgeDirection[];
