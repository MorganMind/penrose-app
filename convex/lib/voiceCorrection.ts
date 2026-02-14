/**
 * Corrective prompt augmentation for voice safety failures.
 *
 * When a suggestion fails the voice threshold, these functions
 * produce progressively stricter prompt modifications for retry.
 */

import type { VoiceFingerprint, EditorialMode } from "./voiceTypes";

export function buildConstraintBoostSuffix(
  scores: {
    semanticScore: number;
    stylisticScore: number;
    scopeScore: number;
  },
  thresholds: {
    semantic: number;
    stylistic: number;
    scope: number;
  },
  profileFingerprint: VoiceFingerprint | null,
  mode: EditorialMode
): string {
  const parts: string[] = [
    "\n\nCRITICAL VOICE SAFETY CONSTRAINTS (your previous suggestion drifted from the author's voice — you MUST correct this):",
  ];

  if (scores.semanticScore < thresholds.semantic) {
    parts.push(
      "- You changed the MEANING of the text. Do NOT add claims, remove arguments, or alter the author's position. Preserve every substantive point."
    );
  }

  if (scores.stylisticScore < thresholds.stylistic && profileFingerprint) {
    const fp = profileFingerprint;
    const styleParts: string[] = [];

    styleParts.push(
      `- The author's average sentence length is ~${Math.round(fp.avgSentenceLength)} words. Match this.`
    );

    if (fp.contractionFrequency > 0.02) {
      styleParts.push(
        "- The author uses contractions freely. Use contractions."
      );
    } else if (fp.contractionFrequency < 0.005) {
      styleParts.push(
        "- The author avoids contractions. Do not add contractions."
      );
    }

    if (fp.hedgingFrequency > 0.15) {
      styleParts.push(
        "- The author uses hedging language naturally. Do not remove qualifiers."
      );
    } else if (fp.hedgingFrequency < 0.05) {
      styleParts.push(
        "- The author is direct and decisive. Do not add hedging language."
      );
    }

    if (fp.questionRatio > 0.1) {
      styleParts.push(
        "- The author uses rhetorical questions. Preserve this pattern."
      );
    }

    if (fp.exclamationRatio > 0.05) {
      styleParts.push(
        "- The author uses exclamation marks. This is intentional — preserve it."
      );
    }

    const readLevel =
      fp.readabilityScore < 8
        ? "accessible and conversational"
        : fp.readabilityScore < 12
          ? "moderate complexity"
          : "dense and academic";
    styleParts.push(
      `- The author's writing is ${readLevel} (grade level ~${Math.round(fp.readabilityScore)}). Do not change the complexity level.`
    );

    parts.push(...styleParts);
  }

  if (scores.scopeScore < thresholds.scope) {
    const scopeMsg: Record<EditorialMode, string> = {
      copy:
        "- You exceeded copy editing scope. Do NOT rephrase, restructure, or rework sentences. Fix only spelling, grammar, and punctuation.",
      line: "- You exceeded line editing scope. Do NOT reorganize paragraphs or add/remove sections. Refine sentences in place.",
      developmental:
        "- Even in developmental editing, preserve the author's paragraph count approximately. Restructure argument flow, but do not inflate or deflate the text dramatically.",
    };
    parts.push(scopeMsg[mode]);
  }

  parts.push(
    "- Make FEWER changes. When in doubt, leave the original phrasing intact.",
    "- Your output must read as if the original author wrote it, not as if an editor rewrote it."
  );

  return parts.join("\n");
}

export function buildMinimalEditPrompt(mode: EditorialMode): string {
  const instructions: Record<EditorialMode, string> = {
    copy: `You are a copy editor making MINIMAL corrections. Find the single most important grammar, spelling, or punctuation error and fix only that. If there are no errors, return the text unchanged. Do not rephrase anything. Output only the corrected text.`,
    line: `You are a line editor making ONE refinement. Find the single weakest sentence and improve only that sentence. Leave everything else exactly as written. Do not reorganize. Do not add transitions. Output the full text with your one change.`,
    developmental: `You are a developmental editor making ONE structural observation. If the argument has a single clear gap, address only that gap with minimal text. If the structure is sound, return the text unchanged. Do not rewrite voice or style. Output the full text.`,
  };

  return instructions[mode];
}
