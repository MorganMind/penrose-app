"use client";

import type { SuggestionContext } from "./extensions";

/**
 * Mock suggestion provider for testing the ghost text UI.
 * Replace with actual AI integration later.
 */

const PLACEHOLDER_COMPLETIONS: Record<string, string[]> = {
  "The ": [
    "quick brown fox jumps over the lazy dog.",
    "sun was setting behind the mountains.",
    "door creaked open slowly.",
  ],
  "I think ": [
    "we should consider this more carefully.",
    "there's a better way to approach this.",
    "the key insight here is simplicity.",
  ],
  "This is ": [
    "exactly what we needed.",
    "a fascinating development.",
    "worth exploring further.",
  ],
};

const SENTENCE_CONTINUATIONS = [
  " However, there's more to consider.",
  " This raises an interesting question.",
  " The implications are significant.",
  " Let me explain further.",
];

/**
 * Simulates suggestion latency for testing UI states
 */
function simulateLatency(): Promise<void> {
  const rand = Math.random();
  let delay: number;

  if (rand < 0.3) {
    delay = 50 + Math.random() * 50;
  } else if (rand < 0.7) {
    delay = 100 + Math.random() * 400;
  } else {
    delay = 500 + Math.random() * 1000;
  }

  return new Promise((resolve) => setTimeout(resolve, delay));
}

export async function getMockSuggestion(
  context: SuggestionContext
): Promise<string | null> {
  const { textBefore } = context;

  await simulateLatency();

  for (const [prefix, completions] of Object.entries(PLACEHOLDER_COMPLETIONS)) {
    if (textBefore.endsWith(prefix)) {
      const completion =
        completions[Math.floor(Math.random() * completions.length)];
      return completion;
    }
  }

  if (/[.!?]\s*$/.test(textBefore) && textBefore.trim().length > 20) {
    return SENTENCE_CONTINUATIONS[
      Math.floor(Math.random() * SENTENCE_CONTINUATIONS.length)
    ];
  }

  if (textBefore.trim().length > 10 && Math.random() < 0.2) {
    return "...";
  }

  return null;
}
