"use node";

/**
 * Server-side actions for realtime writing suggestions.
 * Separate from full editorial passes — uses its own LLM variable,
 * scoped prompts, and lightweight scoring.
 */

import { action } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";

import {
  REALTIME_MODEL_CONFIG,
  computeAggressiveness,
  buildVoiceBlock,
  buildGhostCompletionPrompt,
  buildReplacementPrompt,
} from "../lib/realtimeSuggestions";
import {
  computeStylisticScore,
  computeScopeScore,
  semanticHeuristicPenalty,
  computeCombinedScore,
} from "../lib/voiceScoring";
import { classify } from "../lib/voiceEnforcement";
import { extractFingerprint } from "../lib/voiceFingerprint";
import {
  passesThresholds,
  getThresholds,
  MIN_SAMPLES_FOR_ENFORCEMENT,
} from "../lib/voiceThresholds";

// ── LLM provider abstraction ────────────────────────────────────────────

const REALTIME_PROVIDER = process.env.REALTIME_LLM_PROVIDER ?? "openai";
const REALTIME_MODEL = process.env.REALTIME_LLM_MODEL ?? "gpt-4o-mini";
const REALTIME_PROMPT_VERSION = "realtime-v1";

async function callRealtimeLLM(
  system: string,
  user: string,
  config: { temperature: number; maxTokens: number; topP: number }
): Promise<string> {
  if (REALTIME_PROVIDER === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: REALTIME_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        top_p: config.topP,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI API error (${res.status}): ${text}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === "string" ? content.trim() : "NULL";
  }

  throw new Error(`Unsupported realtime LLM provider: ${REALTIME_PROVIDER}`);
}

// ── Auth helper ───────────────────────────────────────────────────────────

async function getCurrentUser(ctx: ActionCtx): Promise<{ userId: Id<"users"> } | null> {
  const raw = await ctx.runQuery(api.users.whoami, {});
  if (!raw || typeof raw !== "object" || !("userId" in raw)) {
    return null;
  }
  return { userId: (raw as { userId: Id<"users"> }).userId };
}

// ── Ghost completion action ──────────────────────────────────────────────

export const getGhostSuggestion = action({
  args: {
    textBefore: v.string(),
    blockText: v.string(),
    fullText: v.string(),
    cursorPos: v.number(),
    orgId: v.optional(v.id("orgs")),
    postId: v.optional(v.id("posts")),
  },
  handler: async (ctx, args): Promise<string | null> => {
    const startTime = Date.now();
    const userInfo = await getCurrentUser(ctx);
    if (!userInfo) return null;

    const profile = await ctx.runQuery(
      internal.voiceProfiles.getProfileInternal,
      { userId: userInfo.userId, orgId: args.orgId }
    );

    const profileConfidence = profile?.confidence ?? null;
    const fingerprint = profile?.fingerprint ?? null;
    const sampleCount = profile?.sampleCount ?? 0;

    const aggressiveness = computeAggressiveness(profileConfidence);
    const voiceBlock = buildVoiceBlock(
      fingerprint as import("../lib/voiceTypes").VoiceFingerprint | null
    );

    const { system, user: userPrompt } = buildGhostCompletionPrompt({
      textBefore: args.textBefore,
      blockText: args.blockText,
      voiceBlock,
      aggressivenessModifier: aggressiveness.promptModifier,
    });

    const config = REALTIME_MODEL_CONFIG.ghost_completion;
    let rawResponse: string;
    try {
      rawResponse = await callRealtimeLLM(system, userPrompt, config);
    } catch {
      await ctx.runMutation(internal.ai.realtimeSuggestionsMetrics.recordSuggestionMetric, {
        userId: userInfo.userId,
        orgId: args.orgId,
        postId: args.postId,
        mode: "ghost_completion",
        provider: REALTIME_PROVIDER,
        model: REALTIME_MODEL,
        promptVersion: REALTIME_PROMPT_VERSION,
        profileConfidence: profileConfidence ?? undefined,
        aggressivenessLevel: aggressiveness.level,
        wasGenerated: false,
        wasSuppressed: true,
        suppressionReason: "llm_error",
        latencyMs: Date.now() - startTime,
      });
      return null;
    }

    if (!rawResponse || rawResponse === "NULL" || rawResponse.length === 0) {
      await ctx.runMutation(internal.ai.realtimeSuggestionsMetrics.recordSuggestionMetric, {
        userId: userInfo.userId,
        orgId: args.orgId,
        postId: args.postId,
        mode: "ghost_completion",
        provider: REALTIME_PROVIDER,
        model: REALTIME_MODEL,
        promptVersion: REALTIME_PROMPT_VERSION,
        profileConfidence: profileConfidence ?? undefined,
        aggressivenessLevel: aggressiveness.level,
        wasGenerated: true,
        wasSuppressed: false,
        latencyMs: Date.now() - startTime,
      });
      return null;
    }

    let suggestion = rawResponse.replace(/^["']+|["']+$/g, "").trim();

    if (fingerprint && sampleCount >= MIN_SAMPLES_FOR_ENFORCEMENT) {
      const origFp = extractFingerprint(args.textBefore);
      const sugFp = extractFingerprint(args.textBefore + suggestion);

      const heuristicPenalty = semanticHeuristicPenalty(
        args.textBefore,
        args.textBefore + suggestion
      );
      const semanticScore = heuristicPenalty;
      const stylisticScore = computeStylisticScore(
        sugFp,
        fingerprint as import("../lib/voiceTypes").VoiceFingerprint,
        profileConfidence
      );
      const scopeScore = computeScopeScore(origFp, sugFp, "line");
      const combinedScore = computeCombinedScore(
        { semanticScore, stylisticScore, scopeScore },
        "line",
        profileConfidence
      );

      const enforcementClass = classify(
        combinedScore,
        semanticScore,
        "line",
        profileConfidence
      );

      const thresholds = getThresholds("line");
      const passes = passesThresholds(
        { semanticScore, stylisticScore, scopeScore, combinedScore },
        thresholds
      );

      if (
        enforcementClass === "drift" ||
        enforcementClass === "failure" ||
        !passes
      ) {
        await ctx.runMutation(internal.ai.realtimeSuggestionsMetrics.recordSuggestionMetric, {
          userId: userInfo.userId,
          orgId: args.orgId,
          postId: args.postId,
          mode: "ghost_completion",
          provider: REALTIME_PROVIDER,
          model: REALTIME_MODEL,
          promptVersion: REALTIME_PROMPT_VERSION,
          profileConfidence: profileConfidence ?? undefined,
          aggressivenessLevel: aggressiveness.level,
          wasGenerated: true,
          wasSuppressed: true,
          suppressionReason: `enforcement_${enforcementClass}`,
          semanticScore,
          stylisticScore,
          scopeScore,
          combinedScore,
          enforcementClass,
          latencyMs: Date.now() - startTime,
        });
        return null;
      }

      await ctx.runMutation(internal.ai.realtimeSuggestionsMetrics.recordSuggestionMetric, {
        userId: userInfo.userId,
        orgId: args.orgId,
        postId: args.postId,
        mode: "ghost_completion",
        provider: REALTIME_PROVIDER,
        model: REALTIME_MODEL,
        promptVersion: REALTIME_PROMPT_VERSION,
        profileConfidence: profileConfidence ?? undefined,
        aggressivenessLevel: aggressiveness.level,
        wasGenerated: true,
        wasSuppressed: false,
        semanticScore,
        stylisticScore,
        scopeScore,
        combinedScore,
        enforcementClass,
        latencyMs: Date.now() - startTime,
      });
    } else {
      await ctx.runMutation(internal.ai.realtimeSuggestionsMetrics.recordSuggestionMetric, {
        userId: userInfo.userId,
        orgId: args.orgId,
        postId: args.postId,
        mode: "ghost_completion",
        provider: REALTIME_PROVIDER,
        model: REALTIME_MODEL,
        promptVersion: REALTIME_PROMPT_VERSION,
        profileConfidence: profileConfidence ?? undefined,
        aggressivenessLevel: aggressiveness.level,
        wasGenerated: true,
        wasSuppressed: false,
        latencyMs: Date.now() - startTime,
      });
    }

    return suggestion;
  },
});

// ── Inline replacement action ────────────────────────────────────────────

export const getReplacementSuggestion = action({
  args: {
    word: v.string(),
    wordFrom: v.number(),
    wordTo: v.number(),
    sentence: v.string(),
    blockText: v.string(),
    fullText: v.string(),
    orgId: v.optional(v.id("orgs")),
    postId: v.optional(v.id("posts")),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ replacement: string; reason?: string } | null> => {
    const startTime = Date.now();
    const userInfo = await getCurrentUser(ctx);
    if (!userInfo) return null;

    const profile = await ctx.runQuery(
      internal.voiceProfiles.getProfileInternal,
      { userId: userInfo.userId, orgId: args.orgId }
    );

    const profileConfidence = profile?.confidence ?? null;
    const fingerprint = profile?.fingerprint ?? null;
    const sampleCount = profile?.sampleCount ?? 0;

    const aggressiveness = computeAggressiveness(profileConfidence);
    const voiceBlock = buildVoiceBlock(
      fingerprint as import("../lib/voiceTypes").VoiceFingerprint | null
    );

    const { system, user: userPrompt } = buildReplacementPrompt({
      word: args.word,
      sentence: args.sentence,
      blockText: args.blockText,
      voiceBlock,
      aggressivenessModifier: aggressiveness.promptModifier,
    });

    const config = REALTIME_MODEL_CONFIG.inline_replacement;
    let rawResponse: string;
    try {
      rawResponse = await callRealtimeLLM(system, userPrompt, config);
    } catch {
      await ctx.runMutation(internal.ai.realtimeSuggestionsMetrics.recordSuggestionMetric, {
        userId: userInfo.userId,
        orgId: args.orgId,
        postId: args.postId,
        mode: "inline_replacement",
        provider: REALTIME_PROVIDER,
        model: REALTIME_MODEL,
        promptVersion: REALTIME_PROMPT_VERSION,
        profileConfidence: profileConfidence ?? undefined,
        aggressivenessLevel: aggressiveness.level,
        wasGenerated: false,
        wasSuppressed: true,
        suppressionReason: "llm_error",
        latencyMs: Date.now() - startTime,
      });
      return null;
    }

    if (!rawResponse || rawResponse === "NULL") {
      await ctx.runMutation(internal.ai.realtimeSuggestionsMetrics.recordSuggestionMetric, {
        userId: userInfo.userId,
        orgId: args.orgId,
        postId: args.postId,
        mode: "inline_replacement",
        provider: REALTIME_PROVIDER,
        model: REALTIME_MODEL,
        promptVersion: REALTIME_PROMPT_VERSION,
        profileConfidence: profileConfidence ?? undefined,
        aggressivenessLevel: aggressiveness.level,
        wasGenerated: true,
        wasSuppressed: false,
        latencyMs: Date.now() - startTime,
      });
      return null;
    }

    let parsed: { replacement: string; reason?: string };
    try {
      const cleaned = rawResponse.replace(/^```json?\s*|\s*```$/g, "").trim();
      parsed = JSON.parse(cleaned);
      if (!parsed.replacement || typeof parsed.replacement !== "string") {
        return null;
      }
    } catch {
      const trimmed = rawResponse.replace(/^["']+|["']+$/g, "").trim();
      if (trimmed && trimmed !== args.word && trimmed.length < 50) {
        parsed = { replacement: trimmed };
      } else {
        return null;
      }
    }

    if (parsed.replacement.toLowerCase() === args.word.toLowerCase()) {
      return null;
    }

    if (fingerprint && sampleCount >= MIN_SAMPLES_FOR_ENFORCEMENT) {
      const originalSentence = args.sentence;
      const modifiedSentence = args.sentence.replace(args.word, parsed.replacement);

      const originalFp = extractFingerprint(originalSentence);
      const modifiedFp = extractFingerprint(modifiedSentence);

      const heuristicPenalty = semanticHeuristicPenalty(
        originalSentence,
        modifiedSentence
      );
      const semanticScore = heuristicPenalty;
      const stylisticScore = computeStylisticScore(
        modifiedFp,
        fingerprint as import("../lib/voiceTypes").VoiceFingerprint,
        profileConfidence
      );
      const scopeScore = computeScopeScore(originalFp, modifiedFp, "copy");
      const combinedScore = computeCombinedScore(
        { semanticScore, stylisticScore, scopeScore },
        "copy",
        profileConfidence
      );

      const enforcementClass = classify(
        combinedScore,
        semanticScore,
        "copy",
        profileConfidence
      );

      const thresholds = getThresholds("copy");
      const passes = passesThresholds(
        { semanticScore, stylisticScore, scopeScore, combinedScore },
        thresholds
      );

      if (
        enforcementClass === "drift" ||
        enforcementClass === "failure" ||
        !passes
      ) {
        await ctx.runMutation(internal.ai.realtimeSuggestionsMetrics.recordSuggestionMetric, {
          userId: userInfo.userId,
          orgId: args.orgId,
          postId: args.postId,
          mode: "inline_replacement",
          provider: REALTIME_PROVIDER,
          model: REALTIME_MODEL,
          promptVersion: REALTIME_PROMPT_VERSION,
          profileConfidence: profileConfidence ?? undefined,
          aggressivenessLevel: aggressiveness.level,
          wasGenerated: true,
          wasSuppressed: true,
          suppressionReason: `enforcement_${enforcementClass}`,
          semanticScore,
          stylisticScore,
          scopeScore,
          combinedScore,
          enforcementClass,
          latencyMs: Date.now() - startTime,
        });
        return null;
      }

      await ctx.runMutation(internal.ai.realtimeSuggestionsMetrics.recordSuggestionMetric, {
        userId: userInfo.userId,
        orgId: args.orgId,
        postId: args.postId,
        mode: "inline_replacement",
        provider: REALTIME_PROVIDER,
        model: REALTIME_MODEL,
        promptVersion: REALTIME_PROMPT_VERSION,
        profileConfidence: profileConfidence ?? undefined,
        aggressivenessLevel: aggressiveness.level,
        wasGenerated: true,
        wasSuppressed: false,
        semanticScore,
        stylisticScore,
        scopeScore,
        combinedScore,
        enforcementClass,
        latencyMs: Date.now() - startTime,
      });
    } else {
      await ctx.runMutation(internal.ai.realtimeSuggestionsMetrics.recordSuggestionMetric, {
        userId: userInfo.userId,
        orgId: args.orgId,
        postId: args.postId,
        mode: "inline_replacement",
        provider: REALTIME_PROVIDER,
        model: REALTIME_MODEL,
        promptVersion: REALTIME_PROMPT_VERSION,
        profileConfidence: profileConfidence ?? undefined,
        aggressivenessLevel: aggressiveness.level,
        wasGenerated: true,
        wasSuppressed: false,
        latencyMs: Date.now() - startTime,
      });
    }

    return {
      replacement: parsed.replacement,
      reason: parsed.reason,
    };
  },
});
