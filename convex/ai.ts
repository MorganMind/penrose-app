"use node";

import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { callModel, promptVersionId } from "./lib/aiClient";
import {
  EDITORIAL_MODES,
  EditorialMode,
  augmentPromptWithPreferences,
} from "./lib/prompts";
import { NUDGE_DIRECTIONS, NudgeDirection } from "./lib/nudges";
import {
  buildConstraintBoostSuffix,
  buildMinimalEditPrompt,
} from "./lib/voiceCorrection";
import { extractFingerprint } from "./lib/voiceFingerprint";
import {
  computeStylisticScore,
  computeScopeScore,
  computeCombinedScore,
  semanticHeuristicPenalty,
} from "./lib/voiceScoring";
import { passesThresholds } from "./lib/voiceThresholds";
import type { VoiceFingerprint, CorrectionType } from "./lib/voiceTypes";
import type { VoiceEvaluationOutput } from "./voiceEngine";
import type { MultiCandidateResult } from "./multiCandidate";

// ── Types ────────────────────────────────────────────────────────────────────

type RefinementResult = {
  originalText: string;
  suggestedText: string;
  mode: EditorialMode;
  provider: string;
  model: string;
  promptVersion: string;
  // Multi-candidate fields (present for developmental/line)
  runId?: Id<"editorialRuns">;
  candidateIndex?: number;
  hasAlternate?: boolean;
  totalCandidates?: number;
  fallbackUsed?: boolean;
  returnedOriginal?: boolean;
  enforcementClass?: string;
  enforcementOutcome?: string;
  // Debug
  voiceEvaluation?: {
    scores: {
      semanticScore: number;
      stylisticScore: number;
      scopeScore: number;
      combinedScore: number;
    };
    selectionScore?: number;
    passed: boolean;
    enforced: boolean;
    profileStatus: string;
    correctionApplied?: CorrectionType;
  };
};

// ── Context extraction helpers ───────────────────────────────────────────────

type UserInfo = {
  userId: Id<"users">;
  orgs: Array<{ orgId: Id<"orgs"> }>;
};

type SourceContext = {
  sourceText: string;
  orgId: Id<"orgs"> | undefined;
  scratchpad: string | null;
};

async function authenticateUser(ctx: ActionCtx): Promise<UserInfo> {
  const raw = await ctx.runQuery(api.users.whoami, {});
  if (!raw || typeof raw !== "object" || !("userId" in raw)) {
    throw new Error("Unauthenticated");
  }
  return raw as UserInfo;
}

async function extractSourceContext(
  ctx: ActionCtx,
  args: { postId?: Id<"posts">; text?: string },
  userInfo: UserInfo
): Promise<SourceContext> {
  let sourceText: string;
  let orgId: Id<"orgs"> | undefined;
  let scratchpad: string | null = null;

  if (args.postId) {
    const post = (await ctx.runQuery(api.posts.getPost, {
      postId: args.postId,
    })) as {
      orgId: Id<"orgs">;
      body: string | null;
      status: string;
    } | null;

    if (!post) throw new Error("Post not found or access denied");
    if (post.status !== "draft" && post.status !== "scheduled") {
      throw new Error(
        "Editorial passes may only run on draft or scheduled posts."
      );
    }

    sourceText = post.body ?? "";
    orgId = post.orgId;

    try {
      const pref = await ctx.runQuery(api.voicePreferences.getForOrg, {
        orgId: post.orgId,
      });
      if (
        pref &&
        typeof pref === "object" &&
        "content" in pref &&
        pref.content
      ) {
        scratchpad = pref.content as string;
      }
    } catch {
      // optional
    }
  } else if (args.text) {
    sourceText = args.text;
    if (userInfo.orgs.length > 0) orgId = userInfo.orgs[0].orgId;
  } else {
    throw new Error("Either postId or text must be provided");
  }

  if (!sourceText.trim()) throw new Error("Cannot refine empty content");

  return { sourceText, orgId, scratchpad };
}

// ── Multi-candidate path (developmental + line) ─────────────────────────────

async function runMultiCandidateRefinement(
  ctx: ActionCtx,
  args: { postId?: Id<"posts">; text?: string },
  mode: "developmental" | "line",
  nudgeDirection?: NudgeDirection
): Promise<RefinementResult> {
  const userInfo = await authenticateUser(ctx);
  const { sourceText, orgId, scratchpad } = await extractSourceContext(
    ctx,
    args,
    userInfo
  );

  const mcResult = (await ctx.runAction(
    internal.multiCandidate.generate,
    {
      userId: userInfo.userId,
      orgId,
      postId: args.postId,
      originalText: sourceText,
      editorialMode: mode,
      variationSeed: 0,
      nudgeDirection: nudgeDirection ?? undefined,
      scratchpadContent: scratchpad ?? undefined,
    }
  )) as MultiCandidateResult;

  return multiCandidateToResult(mcResult);
}

function multiCandidateToResult(mc: MultiCandidateResult): RefinementResult {
  const result: RefinementResult = {
    originalText: mc.originalText,
    suggestedText: mc.suggestedText,
    mode: mc.mode,
    provider: mc.provider,
    model: mc.model,
    promptVersion: mc.promptVersion,
    runId: mc.runId,
    candidateIndex: mc.candidateIndex,
    hasAlternate: mc.hasAlternate,
    totalCandidates: mc.totalCandidates,
    fallbackUsed: mc.fallbackUsed,
    returnedOriginal: mc.returnedOriginal,
    enforcementClass: mc.enforcementClass,
    enforcementOutcome: mc.enforcementOutcome,
  };

  if (mc.voiceEvaluation) {
    result.voiceEvaluation = mc.voiceEvaluation;
  }

  return result;
}

// ── Single-candidate path (copy) ─────────────────────────────────────────────

async function runSingleCandidateRefinement(
  ctx: ActionCtx,
  args: { postId?: Id<"posts">; text?: string },
  mode: EditorialMode,
  nudgeDirection?: NudgeDirection
): Promise<RefinementResult> {
  const userInfo = await authenticateUser(ctx);
  const { sourceText, orgId, scratchpad } = await extractSourceContext(
    ctx,
    args,
    userInfo
  );

  const provider = process.env.AI_PROVIDER ?? "openai";
  const model = process.env.AI_MODEL ?? "gpt-4o-mini";
  const modeConfig = EDITORIAL_MODES[mode];

  let systemPrompt = augmentPromptWithPreferences(
    modeConfig.systemPrompt,
    scratchpad
  );

  if (nudgeDirection) {
    const nudgeConfig = NUDGE_DIRECTIONS[nudgeDirection];
    systemPrompt += `\n\nADDITIONAL DIRECTION FOR THIS PASS:\n${nudgeConfig.instruction}`;
  }

  const promptVer = promptVersionId(modeConfig.systemPrompt);

  let suggestedText = await callModel({
    provider,
    model,
    systemPrompt,
    userPrompt: sourceText,
    temperature: modeConfig.modelConfig.temperature,
  });

  const evaluation = (await ctx.runAction(internal.voiceEngine.evaluate, {
    userId: userInfo.userId,
    orgId,
    postId: args.postId,
    originalText: sourceText,
    suggestedText,
    editorialMode: mode,
    provider,
    model,
    promptVersion: promptVer,
  })) as VoiceEvaluationOutput;

  let correctionApplied: CorrectionType | undefined;

  if (evaluation.enforced && !evaluation.passed) {
    correctionApplied = await runCorrectionPipeline(ctx, {
      sourceText,
      evaluation,
      mode,
      baseSystemPrompt: systemPrompt,
      provider,
      model,
      modeConfig,
      setSuggestion: (text) => {
        suggestedText = text;
      },
    });
  }

  const showDebug = process.env.VOICE_ENGINE_DEBUG === "true";

  const result: RefinementResult = {
    originalText: sourceText,
    suggestedText,
    mode,
    provider,
    model,
    promptVersion: promptVer,
  };

  if (showDebug) {
    result.voiceEvaluation = {
      scores: evaluation.scores,
      passed: evaluation.passed,
      enforced: evaluation.enforced,
      profileStatus: evaluation.profileStatus,
      correctionApplied,
    };
  }

  return result;
}

// ── Corrective pipeline (copy mode only now) ─────────────────────────────────

async function runCorrectionPipeline(
  ctx: ActionCtx,
  params: {
    sourceText: string;
    evaluation: VoiceEvaluationOutput;
    mode: EditorialMode;
    baseSystemPrompt: string;
    provider: string;
    model: string;
    modeConfig: (typeof EDITORIAL_MODES)[EditorialMode];
    setSuggestion: (text: string) => void;
  }
): Promise<CorrectionType> {
  const {
    sourceText,
    evaluation,
    mode,
    baseSystemPrompt,
    provider,
    model,
    modeConfig,
    setSuggestion,
  } = params;

  // Attempt 1: constraint boost
  const constraintSuffix = buildConstraintBoostSuffix(
    evaluation.scores,
    evaluation.thresholds,
    evaluation.profileFingerprint,
    mode
  );
  const boostedPrompt = baseSystemPrompt + constraintSuffix;

  const boostedSuggestion = await callModel({
    provider,
    model,
    systemPrompt: boostedPrompt,
    userPrompt: sourceText,
    temperature: Math.max(0.1, modeConfig.modelConfig.temperature - 0.1),
  });

  const boostedScores = quickScore(
    sourceText,
    boostedSuggestion,
    evaluation.profileFingerprint,
    mode
  );

  if (
    passesThresholds(
      { ...boostedScores, combinedScore: boostedScores.combined },
      evaluation.thresholds
    )
  ) {
    setSuggestion(boostedSuggestion);
    if (evaluation.evaluationId) {
      try {
        await ctx.runAction(internal.voiceEngine.recordCorrection, {
          evaluationId: evaluation.evaluationId,
          correctionType: "constraint_boost",
          finalCombinedScore: boostedScores.combined,
          improved: true,
        });
      } catch {
        // ignore
      }
    }
    return "constraint_boost";
  }

  // Attempt 2: minimal edit
  const minimalPrompt = buildMinimalEditPrompt(mode);
  const minimalSuggestion = await callModel({
    provider,
    model,
    systemPrompt: minimalPrompt,
    userPrompt: sourceText,
    temperature: 0.1,
  });

  const minimalScores = quickScore(
    sourceText,
    minimalSuggestion,
    evaluation.profileFingerprint,
    mode
  );

  if (minimalScores.combined > evaluation.scores.combinedScore) {
    setSuggestion(minimalSuggestion);
    if (evaluation.evaluationId) {
      try {
        await ctx.runAction(internal.voiceEngine.recordCorrection, {
          evaluationId: evaluation.evaluationId,
          correctionType: "minimal_edit",
          finalCombinedScore: minimalScores.combined,
          improved: true,
        });
      } catch {
        // ignore
      }
    }
    return "minimal_edit";
  }

  // Fallback: passthrough
  if (boostedScores.combined > evaluation.scores.combinedScore) {
    setSuggestion(boostedSuggestion);
  }
  if (evaluation.evaluationId) {
    try {
      await ctx.runAction(internal.voiceEngine.recordCorrection, {
        evaluationId: evaluation.evaluationId,
        correctionType: "passthrough",
        finalCombinedScore: Math.max(
          boostedScores.combined,
          minimalScores.combined,
          evaluation.scores.combinedScore
        ),
        improved: false,
      });
    } catch {
      // ignore
    }
  }
  return "passthrough";
}

function quickScore(
  originalText: string,
  suggestionText: string,
  profileFingerprint: VoiceFingerprint | null,
  mode: EditorialMode
) {
  const origFp = extractFingerprint(originalText);
  const sugFp = extractFingerprint(suggestionText);

  const semanticScore = semanticHeuristicPenalty(originalText, suggestionText);
  const stylisticTarget = profileFingerprint ?? origFp;
  const stylisticScore = computeStylisticScore(sugFp, stylisticTarget);
  const scopeScore = computeScopeScore(origFp, sugFp, mode);
  const combined = computeCombinedScore(
    { semanticScore, stylisticScore, scopeScore },
    mode
  );

  return { semanticScore, stylisticScore, scopeScore, combined };
}

// ── Public actions ───────────────────────────────────────────────────────────

const refineArgs = {
  postId: v.optional(v.id("posts")),
  text: v.optional(v.string()),
};

export const refineDevelopmental = action({
  args: refineArgs,
  handler: async (ctx, args) =>
    runMultiCandidateRefinement(ctx, args, "developmental"),
});

export const refineLine = action({
  args: refineArgs,
  handler: async (ctx, args) =>
    runMultiCandidateRefinement(ctx, args, "line"),
});

export const refineLineWithText = action({
  args: {
    text: v.string(),
    nudgeDirection: v.optional(v.string()),
  },
  handler: async (ctx, { text, nudgeDirection }) =>
    runMultiCandidateRefinement(
      ctx,
      { text },
      "line",
      nudgeDirection as NudgeDirection
    ),
});

export const refineCopy = action({
  args: refineArgs,
  handler: async (ctx, args) =>
    runSingleCandidateRefinement(ctx, args, "copy"),
});

/**
 * Directional nudge — always generates a fresh multi-candidate run
 * for developmental/line, or a single-candidate pass for copy.
 * The nudge direction is applied to all candidates equally.
 */
export const refineWithNudge = action({
  args: {
    postId: v.id("posts"),
    mode: v.union(
      v.literal("developmental"),
      v.literal("line"),
      v.literal("copy")
    ),
    nudgeDirection: v.string(),
  },
  handler: async (ctx, { postId, mode, nudgeDirection }) => {
    const m = mode as EditorialMode;
    const nd = nudgeDirection as NudgeDirection;

    if (m === "developmental" || m === "line") {
      return runMultiCandidateRefinement(ctx, { postId }, m, nd);
    }
    return runSingleCandidateRefinement(ctx, { postId }, m, nd);
  },
});

/**
 * Try again — swaps to the next best unshown candidate from the
 * current run, or generates a fresh run with a new variation seed
 * if all candidates have been shown.
 *
 * For copy mode (no multi-candidate), this regenerates directly.
 */
export const tryAgainFromRun = action({
  args: {
    runId: v.id("editorialRuns"),
  },
  handler: async (ctx, { runId }): Promise<RefinementResult> => {
    const userInfo = await authenticateUser(ctx);

    const mcResult = (await ctx.runAction(
      internal.multiCandidate.tryAgain,
      {
        runId,
        userId: userInfo.userId,
      }
    )) as MultiCandidateResult;

    return multiCandidateToResult(mcResult);
  },
});

/**
 * Try again for copy mode or text-only flows where there is no run.
 * Simply re-runs the single-candidate pipeline.
 */
export const tryAgainSingle = action({
  args: {
    postId: v.optional(v.id("posts")),
    text: v.optional(v.string()),
    mode: v.union(
      v.literal("developmental"),
      v.literal("line"),
      v.literal("copy")
    ),
  },
  handler: async (ctx, { postId, text, mode }) => {
    const m = mode as EditorialMode;
    if (m === "developmental" || m === "line") {
      return runMultiCandidateRefinement(ctx, { postId, text }, m);
    }
    return runSingleCandidateRefinement(ctx, { postId, text }, m);
  },
});
