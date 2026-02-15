"use client";

import type { ReplacementContext, ReplacementSuggestion } from "./extensions/inlineReplacement";

/**
 * Mock replacement provider for testing.
 * Rule: replace any word starting with "s" (case-insensitive) that is 4+ characters.
 * Swap with the real editorial engine once interaction testing passes.
 */

const MOCK_REPLACEMENTS: Record<string, { replacement: string; reason: string }> = {
  some: { replacement: "several", reason: "more precise" },
  said: { replacement: "stated", reason: "stronger attribution" },
  show: { replacement: "demonstrate", reason: "more formal" },
  stop: { replacement: "cease", reason: "tighter" },
  sure: { replacement: "certain", reason: "more definitive" },
  stay: { replacement: "remain", reason: "tighter" },
  seem: { replacement: "appear", reason: "clearer" },
  seen: { replacement: "observed", reason: "more precise" },
  such: { replacement: "this kind of", reason: "less vague" },
  soon: { replacement: "shortly", reason: "tighter" },
  sort: { replacement: "category", reason: "more specific" },
  step: { replacement: "phase", reason: "structural" },
  still: { replacement: "nevertheless", reason: "stronger transition" },
  start: { replacement: "begin", reason: "tighter" },
  small: { replacement: "modest", reason: "more nuanced" },
  space: { replacement: "environment", reason: "more specific" },
  share: { replacement: "distribute", reason: "more precise" },
  shape: { replacement: "form", reason: "tighter" },
  shift: { replacement: "transition", reason: "more descriptive" },
  short: { replacement: "brief", reason: "tighter" },
  sound: { replacement: "resonance", reason: "richer" },
  solve: { replacement: "resolve", reason: "more formal" },
  serve: { replacement: "provide", reason: "clearer" },
  sense: { replacement: "awareness", reason: "more specific" },
  story: { replacement: "narrative", reason: "more literary" },
  style: { replacement: "approach", reason: "more general" },
  scene: { replacement: "setting", reason: "more descriptive" },
  scale: { replacement: "magnitude", reason: "more precise" },
  sweet: { replacement: "tender", reason: "less cliché" },
  strong: { replacement: "robust", reason: "more precise" },
  simple: { replacement: "straightforward", reason: "less reductive" },
  system: { replacement: "framework", reason: "more architectural" },
  single: { replacement: "sole", reason: "tighter" },
  signal: { replacement: "indicator", reason: "clearer" },
  silent: { replacement: "hushed", reason: "more evocative" },
  should: { replacement: "ought to", reason: "more deliberate" },
  slowly: { replacement: "gradually", reason: "tighter" },
  subtle: { replacement: "understated", reason: "more precise" },
  sudden: { replacement: "abrupt", reason: "tighter" },
  supply: { replacement: "provision", reason: "more formal" },
  second: { replacement: "subsequent", reason: "more precise" },
  series: { replacement: "sequence", reason: "more precise" },
  select: { replacement: "choose", reason: "simpler" },
  source: { replacement: "origin", reason: "more precise" },
  sought: { replacement: "pursued", reason: "more active" },
  spread: { replacement: "propagated", reason: "more precise" },
  steady: { replacement: "consistent", reason: "more precise" },
  strain: { replacement: "tension", reason: "more evocative" },
  stream: { replacement: "current", reason: "more vivid" },
  strict: { replacement: "rigorous", reason: "more precise" },
  struck: { replacement: "impacted", reason: "more descriptive" },
  submit: { replacement: "propose", reason: "less passive" },
  suffer: { replacement: "endure", reason: "more active" },
  support: { replacement: "bolster", reason: "more dynamic" },
  surface: { replacement: "exterior", reason: "more precise" },
  suggest: { replacement: "propose", reason: "more active" },
  succeed: { replacement: "prevail", reason: "more vivid" },
  strange: { replacement: "peculiar", reason: "more literary" },
  stretch: { replacement: "extend", reason: "tighter" },
  structure: { replacement: "architecture", reason: "more specific" },
  struggle: { replacement: "grapple", reason: "more vivid" },
  separate: { replacement: "distinct", reason: "tighter" },
  specific: { replacement: "particular", reason: "less clinical" },
  standard: { replacement: "benchmark", reason: "more precise" },
  strength: { replacement: "fortitude", reason: "more literary" },
  suddenly: { replacement: "abruptly", reason: "tighter" },
  surprise: { replacement: "astonish", reason: "more vivid" },
  surround: { replacement: "encompass", reason: "more precise" },
  sentence: { replacement: "statement", reason: "more formal" },
  strategy: { replacement: "approach", reason: "less jargon" },
  situation: { replacement: "circumstance", reason: "more formal" },
  something: { replacement: "an element", reason: "more specific" },
  sometimes: { replacement: "occasionally", reason: "more precise" },
  somewhere: { replacement: "in a place", reason: "more grounded" },
  significant: { replacement: "substantial", reason: "tighter" },
};

/**
 * Simulates a brief lookup delay.
 */
function simulateDelay(): Promise<void> {
  const delay = 30 + Math.random() * 120;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export async function getMockReplacement(
  context: ReplacementContext
): Promise<ReplacementSuggestion | null> {
  const { word } = context;

  // Rule: only words starting with S/s, 4+ characters
  if (word.length < 4) return null;
  if (word[0]!.toLowerCase() !== "s") return null;

  await simulateDelay();

  const key = word.toLowerCase();
  const match = MOCK_REPLACEMENTS[key];

  if (match) {
    // Preserve original casing for the replacement
    const isCapitalized = word[0] === word[0]!.toUpperCase();
    let replacement = match.replacement;
    if (isCapitalized) {
      replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }

    return {
      original: word,
      replacement,
      reason: match.reason,
    };
  }

  // Fallback: generic replacement for unknown s-words
  const generic = `[alt: ${word}]`;
  return {
    original: word,
    replacement: generic,
    reason: "test replacement",
  };
}
