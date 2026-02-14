"use node";

/**
 * Shared AI provider abstraction for Convex actions.
 *
 * Used by ai.ts (editorial refinement) and voiceActions.ts (scratchpad validation).
 * Centralizes model calls and prompt versioning for observability.
 */

import { createHash } from "crypto";

export type ModelParams = {
  provider: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
};

export async function callModel(params: ModelParams): Promise<string> {
  const { provider, model, systemPrompt, userPrompt, temperature } = params;

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set. Run: npx convex env set OPENAI_API_KEY sk-..."
      );
    }

    if (process.env.NODE_ENV === "development") {
      console.log("[aiClient] callModel", {
        provider,
        model,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
      });
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[aiClient] OpenAI error", { status: res.status, text });
      throw new Error(`OpenAI API error (${res.status}): ${text}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("Unexpected OpenAI response shape");
    }
    return content;
  }

  throw new Error(`Unknown AI provider: ${provider}`);
}

/**
 * Stable hash of the base prompt for version tracking.
 * Used when storing reactions/nudges to correlate with prompt changes.
 */
export function promptVersionId(basePrompt: string): string {
  return createHash("sha256").update(basePrompt).digest("hex").slice(0, 12);
}
