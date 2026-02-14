"use node";

/**
 * Voice Identity Engine — the main orchestration action.
 *
 * This is the integration point called by ai.ts for every editorial
 * refinement. It:
 *   1. Extracts fingerprints for original and suggestion
 *   2. Loads the author's voice profile (if it exists)
 *   3. Computes semantic similarity via embeddings
 *   4. Computes stylistic similarity via fingerprint comparison
 *   5. Computes scope compliance via structural checks
 *   6. Records the full evaluation for calibration
 */

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type {
  VoiceFingerprint,
  EditorialMode,
  EvaluationResult,
} from "./lib/voiceTypes";
import {
  extractFingerprint,
  MIN_WORDS_FOR_FINGERPRINT,
} from "./lib/voiceFingerprint";
import {
  computeStylisticScore,
  computeScopeScore,
  computeCombinedScore,
  semanticHeuristicPenalty,
} from "./lib/voiceScoring";
import { embeddingCosineSimilarity, getEmbeddings } from "./lib/embeddings";
import { getThresholds, passesThresholds } from "./lib/voiceThresholds";

// ── Types ────────────────────────────────────────────────────────────────────

export type VoiceEvaluationOutput = EvaluationResult & {
  evaluationId: Id<"voiceEvaluations"> | null;
  scores: {
    semanticScore: number;
    stylisticScore: number;
    scopeScore: number;
    combinedScore: number;
  };
  profileConfidence: number | null;
  profileConfidenceBand: string | null;
};

// ── Main evaluation action ───────────────────────────────────────────────────

export const evaluate = internalAction({
  args: {
    userId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
    postId: v.optional(v.id("posts")),
    originalText: v.string(),
    suggestedText: v.string(),
    editorialMode: v.union(
      v.literal("developmental"),
      v.literal("line"),
      v.literal("copy")
    ),
    provider: v.string(),
    model: v.string(),
    promptVersion: v.string(),
  },
  handler: async (ctx, args): Promise<VoiceEvaluationOutput> => {
    const mode = args.editorialMode as EditorialMode;

    const originalFingerprint = extractFingerprint(args.originalText);
    const suggestionFingerprint = extractFingerprint(args.suggestedText);

    // ── Load voice profile with confidence ─────────────────
    const profile = await ctx.runQuery(
      internal.voiceProfiles.getProfileInternal,
      { userId: args.userId, orgId: args.orgId }
    );

    const profileStatus: "none" | "building" | "active" = profile
      ? profile.status
      : "none";

    const profileFingerprint: VoiceFingerprint | null = profile
      ? (profile.fingerprint as VoiceFingerprint)
      : null;

    const profileConfidence: number | null = profile
      ? (profile.confidence ?? null)
      : null;

    const profileConfidenceBand = profile
      ? (profile.confidenceBand ?? null)
      : null;

    const enforced =
      profileStatus === "active" &&
      originalFingerprint.wordCount >= MIN_WORDS_FOR_FINGERPRINT;

    let semanticScore: number;
    try {
      const embeddings = await getEmbeddings([
        args.originalText,
        args.suggestedText,
      ]);
      const rawSemantic = embeddingCosineSimilarity(
        embeddings[0],
        embeddings[1]
      );
      const heuristicPenalty = semanticHeuristicPenalty(
        args.originalText,
        args.suggestedText
      );
      semanticScore = rawSemantic * heuristicPenalty;
    } catch (err) {
      console.error(
        "[voiceEngine] Embeddings failed, using heuristic fallback",
        err
      );
      semanticScore =
        semanticHeuristicPenalty(args.originalText, args.suggestedText) * 0.85;
    }

    // ── Stylistic score (confidence-aware) ─────────────────
    const stylisticTarget = profileFingerprint ?? originalFingerprint;
    const stylisticScore = computeStylisticScore(
      suggestionFingerprint,
      stylisticTarget,
      profileConfidence
    );

    // ── Scope score ────────────────────────────────────────
    const scopeScore = computeScopeScore(
      originalFingerprint,
      suggestionFingerprint,
      mode
    );

    // ── Combined score (confidence-aware) ──────────────────
    const combinedScore = computeCombinedScore(
      { semanticScore, stylisticScore, scopeScore },
      mode,
      profileConfidence
    );

    const thresholds = getThresholds(mode);
    const passed = passesThresholds(
      { semanticScore, stylisticScore, scopeScore, combinedScore },
      thresholds
    );

    let evaluationId: Id<"voiceEvaluations"> | null = null;
    try {
      evaluationId = await ctx.runMutation(
        internal.voiceEvaluations.recordEvaluation,
        {
          userId: args.userId,
          orgId: args.orgId,
          postId: args.postId,
          editorialMode: args.editorialMode,
          originalFingerprint: originalFingerprint as Record<string, unknown>,
          suggestionFingerprint: suggestionFingerprint as Record<string, unknown>,
          profileFingerprint: profileFingerprint
            ? (profileFingerprint as Record<string, unknown>)
            : undefined,
          profileStatus,
          profileConfidence: profileConfidence ?? undefined,
          profileConfidenceBand: profileConfidenceBand ?? undefined,
          semanticScore,
          stylisticScore,
          scopeScore,
          combinedScore,
          thresholds,
          passed: enforced ? passed : true,
          enforced,
          correctionAttempted: false,
          provider: args.provider,
          model: args.model,
          promptVersion: args.promptVersion,
          originalPreview: args.originalText.slice(0, 500),
          suggestionPreview: args.suggestedText.slice(0, 500),
        }
      );
    } catch (err) {
      console.error("[voiceEngine] Failed to record evaluation", err);
    }

    return {
      scores: { semanticScore, stylisticScore, scopeScore, combinedScore },
      thresholds,
      passed: enforced ? passed : true,
      enforced,
      profileStatus,
      originalFingerprint,
      suggestionFingerprint,
      profileFingerprint,
      profileConfidence,
      profileConfidenceBand,
      evaluationId,
    };
  },
});

/**
 * Record a corrective attempt on an existing evaluation.
 */
export const recordCorrection = internalAction({
  args: {
    evaluationId: v.id("voiceEvaluations"),
    correctionType: v.union(
      v.literal("constraint_boost"),
      v.literal("minimal_edit"),
      v.literal("passthrough")
    ),
    finalCombinedScore: v.optional(v.number()),
    improved: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(
      internal.voiceEvaluations.updateCorrection,
      {
        evaluationId: args.evaluationId,
        correctionType: args.correctionType,
        correctionImprovedScore: args.improved,
        finalCombinedScore: args.finalCombinedScore,
      }
    );
  },
});

// ── Profile contribution action ──────────────────────────────────────────────

export const contributeToProfile = internalAction({
  args: {
    userId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
    text: v.string(),
    sourceType: v.union(
      v.literal("published_post"),
      v.literal("manual_revision"),
      v.literal("initial_draft"),
      v.literal("baseline_sample")
    ),
    sourceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const fingerprint = extractFingerprint(args.text);

    if (fingerprint.wordCount < MIN_WORDS_FOR_FINGERPRINT) {
      return { skipped: true, reason: "text_too_short" };
    }

    const profile = await ctx.runQuery(
      internal.voiceProfiles.getProfileInternal,
      {
        userId: args.userId,
        orgId: args.orgId,
      }
    );

    let blendedFingerprint: VoiceFingerprint;
    let alpha: number;

    if (profile) {
      const { blendFingerprints } = await import("./lib/voiceFingerprint");
      const now = Date.now();
      const result = blendFingerprints(
        profile.fingerprint as VoiceFingerprint,
        fingerprint,
        profile.sampleCount,
        profile.averageSampleWordCount ?? profile.totalWordCount / profile.sampleCount,
        profile.lastSampleAt ?? 0,
        now
      );
      blendedFingerprint = result.blended;
      alpha = result.alpha;
    } else {
      blendedFingerprint = fingerprint;
      alpha = 1.0;
    }

    await ctx.runMutation(internal.voiceProfiles.contributeSample, {
      userId: args.userId,
      orgId: args.orgId,
      fingerprint: blendedFingerprint as Record<string, unknown>,
      sampleFingerprint: fingerprint as Record<string, unknown>,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      wordCount: fingerprint.wordCount,
      blendAlpha: alpha,
    });

    return { skipped: false, alpha, wordCount: fingerprint.wordCount };
  },
});
