"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { callModel } from "./lib/aiClient";

const VALIDATION_PROMPT = `You are analyzing an author's stated style preferences for internal contradictions, redundancy, and clarity.

Given the preferences below, respond with a JSON object (and nothing else) with exactly these keys:
- "redundancies": array of strings describing any redundant or duplicate instructions
- "contradictions": array of strings describing any conflicting instructions
- "suggestions": array of strings with recommendations for clearer phrasing

If a category has no issues, return an empty array for that key.
Be concise. Each item should be one sentence.

Scope: Only analyze the writing-style preferences themselves (tone, grammar, vocabulary, structure). Do NOT include anything about model knowledge, training data, data cut-off dates, or AI capabilities. Those topics are out of scope and must never appear in redundancies, contradictions, or suggestions.

PREFERENCES:
`;

/**
 * Validate voice scratchpad content for contradictions and redundancy.
 * Sends the content through the LLM and stores structured feedback.
 */
export const validateScratchpad = action({
  args: {
    orgId: v.id("orgs"),
  },
  handler: async (ctx, { orgId }) => {
    const userInfo = await ctx.runQuery(api.users.whoami);
    if (!userInfo) throw new Error("Unauthenticated");

    const pref = await ctx.runQuery(api.voicePreferences.getForOrg, { orgId });
    if (!pref || !pref.content.trim()) {
      throw new Error("No preferences to validate");
    }

    const provider = process.env.AI_PROVIDER ?? "openai";
    const model = process.env.AI_MODEL ?? "gpt-4o-mini";

    if (process.env.NODE_ENV === "development") {
      console.log("[voiceActions] validateScratchpad", { orgId, contentLength: pref.content.length });
    }

    const raw = await callModel({
      provider,
      model,
      systemPrompt: VALIDATION_PROMPT + pref.content,
      userPrompt: "Analyze the preferences above.",
      temperature: 0.2,
    });

    let parsed: {
      redundancies: string[];
      contradictions: string[];
      suggestions: string[];
    };

    try {
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "");
      parsed = JSON.parse(cleaned);
      if (
        !Array.isArray(parsed.redundancies) ||
        !Array.isArray(parsed.contradictions) ||
        !Array.isArray(parsed.suggestions)
      ) {
        throw new Error("Invalid shape");
      }
      // Filter out any items about data training / model knowledge — out of scope
      const excludePattern = /\b(training\s+data|data\s+cut[- ]?off|knowledge\s+cut[- ]?off|model\s+knowledge)\b/i;
      parsed.redundancies = parsed.redundancies.filter((s) => !excludePattern.test(s));
      parsed.contradictions = parsed.contradictions.filter((s) => !excludePattern.test(s));
      parsed.suggestions = parsed.suggestions.filter((s) => !excludePattern.test(s));
    } catch {
      parsed = {
        redundancies: [],
        contradictions: [],
        suggestions: ["Unable to parse validation response. Review manually."],
      };
    }

    await ctx.runMutation(api.voicePreferences.saveValidationResult, {
      prefId: pref._id,
      validationResult: parsed,
    });

    return parsed;
  },
});
