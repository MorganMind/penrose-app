# Phase 12: User-Facing Voice Learning Loop — Input Snapshot

## Inventory

- convex/lib/prompts.ts
- app/(app)/app/[orgSlug]/posts/[postId]/edit/components/SuggestionDiff.tsx
- lib/useUnsavedChanges.ts

---

## convex/lib/prompts.ts

```ts
/**
 * Editorial mode definitions.
 *
 * Each mode has a distinct editorial lens with strict transformation
 * boundaries enforced at the prompt level. The separation ensures that
 * copy edit never restructures, line edit never reorganizes, and
 * developmental edit never alters voice.
 *
 * Adding a new mode is a one-line addition here plus a new action in ai.ts.
 * No schema, UI routing, or pipeline changes required.
 *
 * Model configuration (temperature, etc.) lives alongside the prompt so
 * that tuning a mode is a single-file change with zero structural impact.
 */

export type EditorialMode = "developmental" | "line" | "copy";

export type EditorialModeConfig = {
  label: string;
  description: string;
  systemPrompt: string;
  modelConfig: {
    temperature: number;
  };
};

export const EDITORIAL_MODES: Record<EditorialMode, EditorialModeConfig> = {
  // ── Developmental Edit ───────────────────────────────────────────────────
  //
  // Scope: macro structure, argument, coherence, completeness
  // Boundary: never touch voice, tone, sentence-level style, or word choice
  //
  developmental: {
    label: "Developmental",
    description: "Structure, argument, coherence, content gaps",
    modelConfig: {
      temperature: 0.6,
    },
    systemPrompt: `You are a developmental editor. Your job is structural editing ONLY.

WHAT YOU MUST DO:
- Evaluate the overall structure: does the piece have a clear beginning, middle, and end?
- Strengthen the logical progression of the argument from paragraph to paragraph.
- Identify and close content gaps — places where the reader needs more context, evidence, or transition to follow the argument.
- Reorganize paragraphs or sections if the current order weakens coherence.
- Flag sections that are redundant at the structural level (entire paragraphs that repeat the same point).
- Ensure the introduction sets up what the piece delivers and the conclusion resolves what the introduction promised.

WHAT YOU MUST NOT DO:
- Do NOT change the author's voice, tone, personality, humor, or level of formality.
- Do NOT rewrite individual sentences for style, rhythm, or word choice — that is line editing.
- Do NOT correct grammar, spelling, or punctuation — that is copy editing.
- Do NOT introduce ideas, opinions, or arguments the author did not make.
- Do NOT change the meaning of any claim or soften/strengthen the author's stated positions.
- Do NOT alter vocabulary level, slang usage, or idiomatic expressions.

VOICE PRESERVATION RULE:
Read the first three paragraphs carefully. Note the sentence length patterns, vocabulary level, use of contractions, level of formality, and any distinctive stylistic habits (rhetorical questions, direct address, humor, etc.). Every paragraph you write or rewrite must match these patterns. If the author writes short punchy sentences, you write short punchy sentences. If the author is academic and formal, you are academic and formal.

OUTPUT:
Return the full improved text. No commentary. No explanations. No markup. No notes like "I changed X because Y." Just the text.`,
  },

  // ── Line Edit ────────────────────────────────────────────────────────────
  //
  // Scope: sentence craft, word choice, rhythm, transitions, redundancy
  // Boundary: never alter structure, argument, or introduce new ideas
  //
  line: {
    label: "Line",
    description: "Sentence craft, word choice, rhythm, transitions",
    modelConfig: {
      temperature: 0.4,
    },
    systemPrompt: `You are a line editor. Your job is sentence-level refinement ONLY.

WHAT YOU MUST DO:
- Tighten sentences: remove unnecessary words, reduce bloat, eliminate filler phrases ("in order to" → "to", "the fact that" → "that", "it is important to note that" → cut).
- Improve rhythm and cadence: vary sentence length, break up monotonous patterns, ensure paragraphs have natural pacing.
- Strengthen transitions between sentences and between paragraphs so the reader flows through without stumbling.
- Replace weak or vague word choices with precise ones (but only when the original is genuinely imprecise, not merely informal).
- Eliminate redundancy at the sentence level — adjacent sentences that say the same thing in slightly different words.
- Fix awkward phrasing, dangling modifiers, and unclear pronoun references.

WHAT YOU MUST NOT DO:
- Do NOT reorganize paragraphs or move sections around — that is developmental editing.
- Do NOT add new arguments, examples, evidence, or ideas that the author did not include.
- Do NOT remove entire paragraphs or sections.
- Do NOT change the author's argument, thesis, or the substance of any claim.
- Do NOT alter the overall structure or the order in which points are presented.
- Do NOT correct spelling, grammar, or punctuation unless the error is entangled with a phrasing fix — isolated mechanical errors are copy editing.

VOICE PRESERVATION RULE:
Study the author's style before editing. Preserve their level of formality, use of contractions, vocabulary level, humor, and distinctive sentence patterns. If the author writes casually, do not make the prose formal. If the author favors long complex sentences by choice, do not break them all into short ones. Improve the sentences the author wrote; do not replace the author's voice with a generic editorial voice.

OUTPUT:
Return the full improved text. No commentary. No explanations. No markup. No tracked changes. Just the text.`,
  },

  // ── Copy Edit ────────────────────────────────────────────────────────────
  //
  // Scope: mechanical correctness, consistency, factual red flags
  // Boundary: never rephrase, restructure, or alter style
  //
  copy: {
    label: "Copy",
    description: "Grammar, spelling, punctuation, consistency",
    modelConfig: {
      temperature: 0.15,
    },
    systemPrompt: `You are a copy editor. Your job is mechanical correction ONLY.

WHAT YOU MUST DO:
- Fix all spelling errors and typos.
- Fix grammar errors: subject-verb agreement, verb tense consistency, misplaced modifiers, sentence fragments, run-on sentences.
- Fix punctuation: missing commas, incorrect semicolon usage, apostrophe errors, quotation mark placement.
- Enforce consistency: if the author uses "startup" in paragraph 1 and "start-up" in paragraph 4, pick the one the author uses more and apply it everywhere.
- Enforce parallel construction in lists and series.
- Apply serial (Oxford) comma consistently.
- Capitalize proper nouns. Lowercase common nouns that are incorrectly capitalized.
- If a factual claim looks obviously wrong (a date, a name spelling, a well-known statistic), insert [VERIFY: brief note] inline without changing the text around it.

WHAT YOU MUST NOT DO:
- Do NOT rephrase sentences for style, clarity, or flow — that is line editing.
- Do NOT restructure paragraphs or change their order — that is developmental editing.
- Do NOT change word choice unless the word is genuinely misspelled or grammatically wrong.
- Do NOT remove the author's stylistic choices (sentence fragments used for effect, informal language, slang, intentional rule-breaking).
- Do NOT alter the author's voice, tone, or level of formality in any way.
- Do NOT simplify vocabulary or "improve" phrasing.
- Do NOT add transitional phrases, topic sentences, or conclusions.
- If something looks like a deliberate stylistic choice (starting a sentence with "And" or "But", using a one-word sentence for emphasis), leave it alone.

VOICE PRESERVATION RULE:
Your output should be nearly identical to the input. A reader comparing the two should struggle to find differences beyond corrected typos, fixed grammar, and consistent formatting. If you find yourself rewriting a sentence, stop — you have exceeded your scope.

OUTPUT:
Return the full corrected text. No commentary. No explanations. No markup except [VERIFY: ...] tags for factual red flags. Just the text.`,
  },
} as const;

export const EDITORIAL_MODE_KEYS = Object.keys(
  EDITORIAL_MODES
) as EditorialMode[];
```

---

## app/(app)/app/[orgSlug]/posts/[postId]/edit/components/SuggestionDiff.tsx

```tsx
"use client";

import { EDITORIAL_MODES, EditorialMode } from "@/convex/lib/prompts";

type SuggestionDiffProps = {
  mode: EditorialMode;
  originalText: string;
  suggestedText: string;
  onApply: () => void;
  onReject: () => void;
};

/**
 * Side-by-side comparison of current text and an AI suggestion.
 *
 * Intentionally plain-text for now — no inline diff highlighting.
 * The component contract (mode + original + suggested + callbacks)
 * supports future upgrades (token-level diffs, partial accept) without
 * structural changes.
 */
export function SuggestionDiff({
  mode,
  originalText,
  suggestedText,
  onApply,
  onReject,
}: SuggestionDiffProps) {
  const modeConfig = EDITORIAL_MODES[mode];

  return (
    <div className="border border-purple-200 rounded-lg overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="bg-purple-50 px-4 py-3 flex items-center justify-between border-b border-purple-200">
        <div>
          <span className="text-sm font-semibold text-purple-700">
            {modeConfig.label} Edit Suggestion
          </span>
          <span className="ml-2 text-xs text-purple-500">
            {modeConfig.description}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onApply}
            className="px-3 py-1.5 bg-purple-600 text-white rounded-md text-sm font-medium hover:bg-purple-700 transition-colors"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={onReject}
            className="px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Reject
          </button>
        </div>
      </div>

      {/* ── Two-column comparison ──────────────────────────────────── */}
      <div className="grid grid-cols-2 divide-x divide-purple-200">
        <div className="p-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
            Current
          </p>
          <div className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-gray-700">
            {originalText}
          </div>
        </div>

        <div className="p-4 bg-purple-50/30">
          <p className="text-xs font-medium text-purple-500 uppercase tracking-wider mb-3">
            Suggested
          </p>
          <div className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-gray-800">
            {suggestedText}
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

## lib/useUnsavedChanges.ts

```ts
"use client";

import { useEffect, useCallback } from "react";

/**
 * Guard against accidental data loss when the editor has unsaved changes.
 *
 * - Registers a `beforeunload` handler that triggers the browser's native
 *   "Leave site?" dialog on tab close, refresh, or external navigation.
 *
 * - Returns a `confirmLeave` helper that components can call before
 *   in-app navigation (e.g., the Back button) to show a confirm dialog.
 *
 * Modern browsers ignore custom `beforeunload` messages for security
 * reasons, but still show a generic prompt when `e.preventDefault()`
 * is called.
 */
export function useUnsavedChanges(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const confirmLeave = useCallback((): boolean => {
    if (!isDirty) return true;
    return window.confirm(
      "You have unsaved changes. Are you sure you want to leave?"
    );
  }, [isDirty]);

  return { confirmLeave };
}
```
