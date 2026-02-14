/**
 * Reaction panel definitions and cadence logic for voice learning.
 *
 * The system collects behavioral signals by showing short reaction
 * panels after editorial suggestions. The cadence tapers as more
 * signals accumulate — aggressive early, invisible later.
 */

export type PanelType = "quality" | "style" | "voice";

export type ReactionOption = {
  key: string;
  label: string;
};

export type PanelConfig = {
  prompt: string;
  options: ReactionOption[];
};

export const REACTION_PANELS: Record<PanelType, PanelConfig> = {
  quality: {
    prompt: "How was this suggestion?",
    options: [
      { key: "perfect", label: "Perfect" },
      { key: "good", label: "Good" },
      { key: "dont_like", label: "Don't like it" },
    ],
  },
  style: {
    prompt: "Any style concerns?",
    options: [
      { key: "too_polished", label: "Too polished" },
      { key: "too_formal", label: "Too formal" },
      { key: "too_long", label: "Too long" },
      { key: "changed_meaning", label: "Changed meaning" },
      { key: "none", label: "No issues" },
    ],
  },
  voice: {
    prompt: "Does this sound like you?",
    options: [
      { key: "sounds_like_me", label: "Sounds just like me" },
      { key: "partly_me", label: "Partly me" },
      { key: "nothing_like_me", label: "Sounds nothing like me" },
    ],
  },
};

const PANEL_ORDER: PanelType[] = ["quality", "style", "voice"];

/**
 * Determine which panel(s) to show given the total reaction count
 * and how many panels have been answered for the current suggestion.
 *
 * Cadence rules:
 *   < 10 total reactions  → show all 3 panels in rotating order
 *   10–24 total           → voice panel only
 *   ≥ 25 total            → voice panel every 5th suggestion
 */
export function getNextPanel(
  totalReactions: number,
  answeredInSession: PanelType[],
  suggestionIndex: number
): PanelType | null {
  if (totalReactions < 10) {
    const offset = totalReactions % PANEL_ORDER.length;
    const rotated = [
      ...PANEL_ORDER.slice(offset),
      ...PANEL_ORDER.slice(0, offset),
    ];
    const next = rotated.find((p) => !answeredInSession.includes(p));
    return next ?? null;
  }

  if (totalReactions < 25) {
    return answeredInSession.includes("voice") ? null : "voice";
  }

  if (suggestionIndex % 5 === 0) {
    return answeredInSession.includes("voice") ? null : "voice";
  }

  return null;
}
