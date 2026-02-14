/**
 * Tiered voice enforcement classification and corrective prompt generation.
 *
 * Four deterministic classifications based on explicit numeric thresholds:
 *
 *  1. PASS — all scores above pass thresholds, return as-is
 *  2. SOFT_WARNING — stylistic drift detected but meaning preserved,
 *     regenerate with stricter stylistic constraints
 *  3. FAILURE — combined score below failure floor, regenerate with
 *     overall strict preservation constraints
 *  4. DRIFT — semantic score below drift threshold (meaning changed),
 *     regenerate with strict meaning preservation regardless of
 *     other scores
 *
 * Classification priority: DRIFT > FAILURE > SOFT_WARNING > PASS
 * Drift is checked first because meaning loss is the most critical
 * violation — a suggestion can score well on style and scope but
 * still introduce claims the author never made.
 *
 * Retry budget: exactly 1. A boolean guard prevents re-entry.
 * If retry candidates still fail, the original text is returned.
 */

import type {
  VoiceFingerprint,
  EditorialMode,
} from "./voiceTypes";
import {
  computeThresholdModulation,
  type ThresholdModulation,
} from "./profileConfidence";

// ── Classification types ─────────────────────────────────────────────────

export type EnforcementClass =
  | "pass"
  | "soft_warning"
  | "failure"
  | "drift";

/**
 * Terminal enforcement outcome stored on the run.
 * "original_returned" means all retry candidates failed and the
 * system returned the author's unmodified text.
 */
export type EnforcementOutcome =
  | "pass"
  | "soft_warning_resolved"
  | "failure_resolved"
  | "drift_resolved"
  | "original_returned";

// ── Tiered thresholds ────────────────────────────────────────────────────

/**
 * Each mode defines three boundary layers:
 *
 *  pass:         combined >= passFloor AND semantic >= semanticPassFloor
 *  soft_warning: combined >= warningFloor AND semantic >= semanticWarningFloor
 *  failure:      combined < warningFloor
 *  drift:        semantic < driftCeiling (checked FIRST, overrides others)
 */
type EnforcementThresholds = {
  passFloor: number; // combined score must be >= this for PASS
  semanticPassFloor: number; // semantic must also be >= this for PASS
  warningFloor: number; // combined score >= this = SOFT_WARNING (not FAILURE)
  semanticWarningFloor: number; // semantic >= this within warning band
  driftCeiling: number; // semantic < this = DRIFT regardless of combined
};

const ENFORCEMENT_THRESHOLDS: Record<EditorialMode, EnforcementThresholds> = {
  line: {
    passFloor: 0.78,
    semanticPassFloor: 0.82,
    warningFloor: 0.65,
    semanticWarningFloor: 0.72,
    driftCeiling: 0.70,
  },
  developmental: {
    passFloor: 0.74,
    semanticPassFloor: 0.78,
    warningFloor: 0.58,
    semanticWarningFloor: 0.68,
    driftCeiling: 0.65,
  },
  copy: {
    passFloor: 0.82,
    semanticPassFloor: 0.85,
    warningFloor: 0.68,
    semanticWarningFloor: 0.75,
    driftCeiling: 0.72,
  },
};

export function getEnforcementThresholds(
  mode: EditorialMode
): EnforcementThresholds {
  return ENFORCEMENT_THRESHOLDS[mode];
}

// ── Confidence-aware classification ──────────────────────────────────────

/**
 * Classify a candidate with confidence-aware thresholds.
 *
 * When profileConfidence is provided, thresholds are modulated:
 *  - Low confidence: stylistic thresholds relax, semantic thresholds tighten
 *  - High confidence: base thresholds apply
 *
 * This ensures early profiles (few samples) don't over-enforce
 * stylistic patterns that haven't been confirmed through repetition,
 * while still strictly preserving meaning from the start.
 */
export function classify(
  combinedScore: number,
  semanticScore: number,
  mode: EditorialMode,
  profileConfidence?: number | null
): EnforcementClass {
  const base = ENFORCEMENT_THRESHOLDS[mode];

  let passFloor = base.passFloor;
  let semanticPassFloor = base.semanticPassFloor;
  let warningFloor = base.warningFloor;
  let semanticWarningFloor = base.semanticWarningFloor;
  let driftCeiling = base.driftCeiling;

  if (profileConfidence != null) {
    const mod = computeThresholdModulation(profileConfidence);

    // Stylistic-sensitive thresholds relax at low confidence
    passFloor = base.passFloor * mod.stylisticRelaxation;
    warningFloor = base.warningFloor * mod.stylisticWarningRelaxation;

    // Semantic-sensitive thresholds tighten at low confidence
    semanticPassFloor = Math.min(
      0.98,
      base.semanticPassFloor * mod.semanticTightening
    );
    semanticWarningFloor = Math.min(
      0.98,
      base.semanticWarningFloor * mod.semanticTightening
    );
    driftCeiling = Math.min(
      0.95,
      base.driftCeiling * mod.driftSensitivity
    );
  }

  // Priority 1: Drift
  if (semanticScore < driftCeiling) {
    return "drift";
  }

  // Priority 2: Pass
  if (combinedScore >= passFloor && semanticScore >= semanticPassFloor) {
    return "pass";
  }

  // Priority 3: Failure
  if (combinedScore < warningFloor) {
    return "failure";
  }

  // Priority 4: Soft warning
  return "soft_warning";
}

/**
 * Convenience: get the effective thresholds after confidence modulation.
 * Used for recording in evaluation data.
 */
export function getEffectiveThresholds(
  mode: EditorialMode,
  profileConfidence?: number | null
): {
  passFloor: number;
  semanticPassFloor: number;
  warningFloor: number;
  driftCeiling: number;
  modulation: ThresholdModulation | null;
} {
  const base = ENFORCEMENT_THRESHOLDS[mode];

  if (profileConfidence == null) {
    return {
      passFloor: base.passFloor,
      semanticPassFloor: base.semanticPassFloor,
      warningFloor: base.warningFloor,
      driftCeiling: base.driftCeiling,
      modulation: null,
    };
  }

  const mod = computeThresholdModulation(profileConfidence);

  return {
    passFloor: base.passFloor * mod.stylisticRelaxation,
    semanticPassFloor: Math.min(
      0.98,
      base.semanticPassFloor * mod.semanticTightening
    ),
    warningFloor: base.warningFloor * mod.stylisticWarningRelaxation,
    driftCeiling: Math.min(
      0.95,
      base.driftCeiling * mod.driftSensitivity
    ),
    modulation: mod,
  };
}

/**
 * Check whether a classification requires enforcement action.
 */
export function requiresEnforcement(ec: EnforcementClass): boolean {
  return ec !== "pass";
}

/**
 * After enforcement retry, determine the terminal outcome.
 */
export function determineOutcome(
  initialClass: EnforcementClass,
  retryBestClass: EnforcementClass
): EnforcementOutcome {
  if (initialClass === "pass") return "pass";

  if (retryBestClass === "pass") {
    switch (initialClass) {
      case "soft_warning":
        return "soft_warning_resolved";
      case "failure":
        return "failure_resolved";
      case "drift":
        return "drift_resolved";
    }
  }

  return "original_returned";
}

// ── Enforcement prompt builders ──────────────────────────────────────────

/**
 * Build the enforcement prompt suffix for SOFT_WARNING.
 *
 * Targets stylistic drift specifically. References measured metrics
 * from the voice profile to give the model concrete numeric targets.
 */
export function buildSoftWarningEnforcement(
  profile: VoiceFingerprint | null,
  mode: EditorialMode
): string {
  const parts: string[] = [
    "",
    "─── ENFORCEMENT: STYLISTIC TIGHTENING ───",
    "Your previous output drifted from the author's measured voice. You MUST match the following stylistic targets exactly.",
    "",
  ];

  if (profile) {
    parts.push(
      `SENTENCE LENGTH: Target ~${Math.round(profile.avgSentenceLength)} words per sentence (σ ≈ ${profile.sentenceLengthStdDev.toFixed(1)}). Do not uniformly lengthen or shorten sentences.`
    );

    if (profile.contractionFrequency > 0.02) {
      parts.push(
        `CONTRACTIONS: The author uses contractions at a rate of ${(profile.contractionFrequency * 100).toFixed(1)}%. USE contractions naturally. Do NOT expand them.`
      );
    } else if (profile.contractionFrequency < 0.005) {
      parts.push(
        "CONTRACTIONS: The author avoids contractions. Do NOT introduce them."
      );
    }

    if (profile.hedgingFrequency > 0.12) {
      parts.push(
        `HEDGING: The author hedges at ${profile.hedgingFrequency.toFixed(2)} phrases per sentence. PRESERVE qualifiers, uncertainty markers, and hedging language.`
      );
    } else if (profile.hedgingFrequency < 0.04) {
      parts.push(
        "HEDGING: The author is direct. Do NOT introduce hedging, qualifiers, or softening language."
      );
    }

    if (profile.questionRatio > 0.08) {
      parts.push(
        `RHETORICAL QUESTIONS: The author uses questions in ~${(profile.questionRatio * 100).toFixed(0)}% of sentences. Preserve this pattern.`
      );
    }

    const readLevel =
      profile.readabilityScore < 8
        ? "accessible (grade ~" + Math.round(profile.readabilityScore) + ")"
        : profile.readabilityScore < 12
          ? "moderate (grade ~" + Math.round(profile.readabilityScore) + ")"
          : "dense (grade ~" + Math.round(profile.readabilityScore) + ")";
    parts.push(
      `COMPLEXITY: The author writes at ${readLevel} level. Do NOT change vocabulary complexity or sentence structure complexity.`
    );

    const punctHighlights: string[] = [];
    if (profile.punctuationFrequencies.dash > 15) {
      punctHighlights.push("dashes (em-dashes or en-dashes)");
    }
    if (profile.punctuationFrequencies.semicolon > 5) {
      punctHighlights.push("semicolons");
    }
    if (profile.punctuationFrequencies.ellipsis > 3) {
      punctHighlights.push("ellipses");
    }
    if (profile.punctuationFrequencies.parenthetical > 8) {
      punctHighlights.push("parentheticals");
    }
    if (punctHighlights.length > 0) {
      parts.push(
        `PUNCTUATION: The author characteristically uses ${punctHighlights.join(", ")}. Preserve these habits.`
      );
    }
  }

  parts.push(
    "",
    "ENFORCEMENT RULE: Make FEWER changes than your first attempt. When uncertain between changing a phrase or leaving it, LEAVE IT.",
    ""
  );

  return parts.join("\n");
}

/**
 * Build the enforcement prompt for FAILURE.
 *
 * Replaces the editorial system prompt with a strictly limited version
 * that allows only the single most impactful change.
 */
export function buildFailureEnforcement(mode: EditorialMode): string {
  const modeInstructions: Record<EditorialMode, string> = {
    line: `You are a line editor making exactly ONE refinement.
Find the single weakest sentence in the text and improve only that sentence.
Leave every other sentence EXACTLY as written — same words, same punctuation, same structure.
Do not reorganize. Do not add transitions. Do not improve "flow" between paragraphs.
If no sentence is clearly weak, return the text UNCHANGED.`,

    developmental: `You are a developmental editor making exactly ONE structural observation.
If the argument has a single clear gap where the reader would be confused, address only that gap with minimal text.
Do not rewrite voice or style. Do not tighten sentences. Do not improve word choice.
If the structure is sound, return the text UNCHANGED.`,

    copy: `You are a copy editor making the single most important mechanical correction.
Find the one most obvious spelling, grammar, or punctuation error and fix only that.
If there are no clear errors, return the text UNCHANGED.
Do not rephrase anything. Do not improve style.`,
  };

  return [
    "─── ENFORCEMENT: STRICT PRESERVATION MODE ───",
    "",
    modeInstructions[mode],
    "",
    "OUTPUT: Return the full text with at most ONE change. No commentary.",
  ].join("\n");
}

/**
 * Build the enforcement prompt suffix for DRIFT.
 *
 * Specifically targets meaning preservation. The model changed
 * the author's claims, arguments, or intent.
 */
export function buildDriftEnforcement(mode: EditorialMode): string {
  return [
    "",
    "─── ENFORCEMENT: MEANING PRESERVATION ───",
    "Your previous output CHANGED THE AUTHOR'S MEANING. This is the highest-priority violation.",
    "",
    "STRICT RULES:",
    "- Every claim the author made must appear in your output UNCHANGED in substance.",
    "- Do NOT add new claims, examples, evidence, statistics, or arguments.",
    "- Do NOT soften or strengthen any position the author took.",
    "- Do NOT introduce qualifications the author did not include.",
    "- Do NOT remove any point, even if it seems redundant.",
    "- Do NOT reframe the author's argument in your own words.",
    "- Compare your output to the original paragraph by paragraph. Each paragraph must convey the same substantive content.",
    "",
    mode === "line"
      ? "You may still tighten phrasing and improve rhythm, but ONLY where meaning is completely preserved."
      : mode === "developmental"
        ? "You may still suggest structural reordering, but ONLY if every point survives intact."
        : "Fix only mechanical errors. Do not rephrase anything.",
    "",
    "If you cannot improve the text without changing its meaning, return it UNCHANGED.",
    "",
  ].join("\n");
}

/**
 * Get the appropriate temperature reduction for enforcement retries.
 * Lower temperature = more conservative output.
 */
export function getEnforcementTemperature(
  baseTemperature: number,
  enforcementClass: EnforcementClass
): number {
  switch (enforcementClass) {
    case "soft_warning":
      return Math.max(0.1, baseTemperature - 0.1);
    case "failure":
      return 0.1;
    case "drift":
      return 0.1;
    case "pass":
      return baseTemperature;
  }
}
