/**
 * Controlled prompt variation system for multi-candidate generation.
 *
 * Variations are intentional, minimal editorial leanings — NOT random
 * temperature-driven drift. Each cycle provides a pair of complementary
 * preferences that nudge the model in subtly different directions while
 * staying strictly within the editorial mode's scope.
 *
 * The variation suffix is appended AFTER all other prompt components
 * (base prompt + scratchpad + nudge). It is the lowest-priority
 * instruction — if it conflicts with the mode's core rules or the
 * author's voice preferences, the model should ignore it.
 */

export type Variation = {
  key: string;
  label: string;
  suffix: string;
};

export type VariationPair = [Variation, Variation];

// ── Line editing variations ──────────────────────────────────────────────

const LINE_VARIATIONS: VariationPair[] = [
  [
    {
      key: "concision_lean",
      label: "Concision lean",
      suffix: `SUBTLE VARIATION PREFERENCE (apply only when two options are equally good):
Lean toward the option that uses fewer words. Prefer compact phrasing over expansive phrasing when both preserve the author's meaning and voice equally well.`,
    },
    {
      key: "cadence_lean",
      label: "Cadence lean",
      suffix: `SUBTLE VARIATION PREFERENCE (apply only when two options are equally good):
Lean toward the option that creates better sentence-to-sentence rhythm. Prefer varied sentence lengths and natural pacing over uniform sentence structure when both preserve the author's meaning and voice equally well.`,
    },
  ],
  [
    {
      key: "precision_lean",
      label: "Precision lean",
      suffix: `SUBTLE VARIATION PREFERENCE (apply only when two options are equally good):
Pay extra attention to word precision. When a more specific or vivid word is available and fits the author's natural vocabulary level, prefer it over a vaguer alternative.`,
    },
    {
      key: "flow_lean",
      label: "Flow lean",
      suffix: `SUBTLE VARIATION PREFERENCE (apply only when two options are equally good):
Pay extra attention to paragraph-level flow. Strengthen the connective tissue between sentences so each thought leads naturally to the next.`,
    },
  ],
  [
    {
      key: "trim_lean",
      label: "Trim lean",
      suffix: `SUBTLE VARIATION PREFERENCE (apply only when two options are equally good):
Focus tightening efforts on removing filler phrases, unnecessary qualifiers, and throat-clearing language. Preserve every substantive word.`,
    },
    {
      key: "transition_lean",
      label: "Transition lean",
      suffix: `SUBTLE VARIATION PREFERENCE (apply only when two options are equally good):
Focus refinement efforts on strengthening transitions between sentences and between paragraphs. Make the reading path smoother without adding weight.`,
    },
  ],
];

// ── Developmental editing variations ─────────────────────────────────────

const DEVELOPMENTAL_VARIATIONS: VariationPair[] = [
  [
    {
      key: "structural_economy",
      label: "Structural economy",
      suffix: `SUBTLE VARIATION PREFERENCE (apply only when two structural approaches are equally valid):
When the structure allows it, prefer tighter organization. If two sections make overlapping points, consider consolidating. Fewer well-developed sections are better than many thin ones.`,
    },
    {
      key: "connective_tissue",
      label: "Connective tissue",
      suffix: `SUBTLE VARIATION PREFERENCE (apply only when two structural approaches are equally valid):
When the structure allows it, prefer stronger transitions and connective tissue between sections. Make sure the reader always knows why they moved from one section to the next.`,
    },
  ],
  [
    {
      key: "gap_closure",
      label: "Gap closure",
      suffix: `SUBTLE VARIATION PREFERENCE (apply only when two structural approaches are equally valid):
Prioritize closing content gaps — places where the reader would need to guess or make assumptions the author hasn't supported. Add just enough context to close the gap, no more.`,
    },
    {
      key: "redundancy_reduction",
      label: "Redundancy reduction",
      suffix: `SUBTLE VARIATION PREFERENCE (apply only when two structural approaches are equally valid):
Prioritize eliminating structural redundancy. Where two paragraphs or sections make overlapping points, consolidate into the stronger version.`,
    },
  ],
  [
    {
      key: "arc_strengthening",
      label: "Arc strengthening",
      suffix: `SUBTLE VARIATION PREFERENCE (apply only when two structural approaches are equally valid):
Strengthen the introduction-to-conclusion arc. Make sure the opening promise is clearly fulfilled by the conclusion and that intermediate sections each advance toward that fulfillment.`,
    },
    {
      key: "internal_logic",
      label: "Internal logic",
      suffix: `SUBTLE VARIATION PREFERENCE (apply only when two structural approaches are equally valid):
Strengthen the internal logic of the argument. Make sure each paragraph earns its place — every section should either set up, develop, or resolve a point the reader needs.`,
    },
  ],
];

// ── Public API ───────────────────────────────────────────────────────────

const VARIATION_MAP: Record<string, VariationPair[]> = {
  line: LINE_VARIATIONS,
  developmental: DEVELOPMENTAL_VARIATIONS,
};

/**
 * Get the variation pair for a given mode and seed.
 * The seed cycles through available pairs.
 */
export function getVariationPair(
  mode: "developmental" | "line",
  seed: number
): VariationPair {
  const pairs = VARIATION_MAP[mode];
  const index = seed % pairs.length;
  return pairs[index];
}

/**
 * Total number of variation cycles available for a mode.
 */
export function getVariationCycleCount(
  mode: "developmental" | "line"
): number {
  return VARIATION_MAP[mode].length;
}
