"use node";

/**
 * Multi-candidate generation engine with tiered enforcement.
 *
 * Flow:
 *  1. Generate 2 initial candidates with controlled variation
 *  2. Score each through the voice engine
 *  3. Classify the best candidate (PASS / SOFT_WARNING / FAILURE / DRIFT)
 *  4. If PASS → store and return
 *  5. If not PASS → ONE enforcement retry:
 *     a. Build enforcement-specific prompt constraints
 *     b. Generate 2 retry candidates
 *     c. Pool all 4 candidates, select best
 *     d. If best is now PASS → return it
 *     e. If still not PASS → return original text unchanged
 *  6. Store ALL candidates and enforcement metadata
 *
 * The retry budget is exactly 1. A boolean guard prevents re-entry.
 * If the retry fails, the original text is always safe to return
 * because it IS the author's voice.
 */

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import { callModel, promptVersionId } from "./lib/aiClient";
import {
  EDITORIAL_MODES,
  augmentPromptWithPreferences,
} from "./lib/prompts";
import type { EditorialMode } from "./lib/prompts";
import { NUDGE_DIRECTIONS } from "./lib/nudges";
import type { NudgeDirection } from "./lib/nudges";
import { getVariationPair } from "./lib/candidateVariations";
import {
  computeSelectionScore,
} from "./lib/candidateSelection";
import {
  buildPreferencePromptSuffix,
} from "./lib/preferenceSignals";
import {
  classify,
  requiresEnforcement,
  determineOutcome,
  buildSoftWarningEnforcement,
  buildFailureEnforcement,
  buildDriftEnforcement,
  getEnforcementTemperature,
  type EnforcementClass,
  type EnforcementOutcome,
} from "./lib/voiceEnforcement";
import type { VoiceFingerprint } from "./lib/voiceTypes";
import type { VoiceEvaluationOutput } from "./voiceEngine";

// ── Types ────────────────────────────────────────────────────────────────

export type MultiCandidateResult = {
  originalText: string;
  suggestedText: string;
  mode: EditorialMode;
  provider: string;
  model: string;
  promptVersion: string;
  runId: Id<"editorialRuns">;
  candidateIndex: number;
  hasAlternate: boolean;
  totalCandidates: number;
  fallbackUsed: boolean;
  returnedOriginal: boolean;
  enforcementClass: EnforcementClass;
  enforcementOutcome: EnforcementOutcome;
  voiceEvaluation?: {
    scores: {
      semanticScore: number;
      stylisticScore: number;
      scopeScore: number;
      combinedScore: number;
    };
    selectionScore: number;
    passed: boolean;
    enforced: boolean;
    profileStatus: string;
  };
};

type ScoredCandidate = {
  index: number;
  text: string;
  variationKey: string;
  evaluation: VoiceEvaluationOutput;
  selectionScore: number;
  enforcementClass: EnforcementClass;
  phase: "initial" | "enforcement_retry";
  isFallback: boolean;
};

// ── Main generation action ───────────────────────────────────────────────

export const generate = internalAction({
  args: {
    userId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
    postId: v.optional(v.id("posts")),
    originalText: v.string(),
    editorialMode: v.union(v.literal("developmental"), v.literal("line")),
    variationSeed: v.number(),
    nudgeDirection: v.optional(v.string()),
    scratchpadContent: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<MultiCandidateResult> => {
    const mode = args.editorialMode as "developmental" | "line";
    const modeConfig = EDITORIAL_MODES[mode];
    const provider = process.env.AI_PROVIDER ?? "openai";
    const model = process.env.AI_MODEL ?? "gpt-4o-mini";
    const promptVer = promptVersionId(modeConfig.systemPrompt);

    // ── Fetch aggregated preference signals (bounded nudges from Apply/Reject) ─
    let preferenceSuffix = "";
    if (args.orgId) {
      try {
        const prefs = await ctx.runQuery(
          api.voicePreferenceSignals.getAggregatedPreferences,
          {
            orgId: args.orgId,
            userId: args.userId,
            editorialMode: args.editorialMode,
          }
        );
        preferenceSuffix = buildPreferencePromptSuffix(prefs) ?? "";
      } catch {
        // Non-blocking
      }
    }

    // ── Build base prompt ──────────────────────────────────────
    let basePrompt = augmentPromptWithPreferences(
      modeConfig.systemPrompt,
      args.scratchpadContent,
      preferenceSuffix || undefined
    );

    if (args.nudgeDirection) {
      const nudgeConfig =
        NUDGE_DIRECTIONS[args.nudgeDirection as NudgeDirection];
      if (nudgeConfig) {
        basePrompt += `\n\nADDITIONAL DIRECTION FOR THIS PASS:\n${nudgeConfig.instruction}`;
      }
    }

    const [variationA, variationB] = getVariationPair(
      mode,
      args.variationSeed
    );

    // ══════════════════════════════════════════════════════════
    // PHASE 1: Generate and score initial candidates
    // ══════════════════════════════════════════════════════════

    const promptA = basePrompt + "\n\n" + variationA.suffix;
    const promptB = basePrompt + "\n\n" + variationB.suffix;

    const [textA, textB] = await Promise.all([
      callModel({
        provider,
        model,
        systemPrompt: promptA,
        userPrompt: args.originalText,
        temperature: modeConfig.modelConfig.temperature,
      }),
      callModel({
        provider,
        model,
        systemPrompt: promptB,
        userPrompt: args.originalText,
        temperature: modeConfig.modelConfig.temperature,
      }),
    ]);

    const [evalA, evalB] = (await Promise.all([
      ctx.runAction(internal.voiceEngine.evaluate, {
        userId: args.userId,
        orgId: args.orgId,
        postId: args.postId,
        originalText: args.originalText,
        suggestedText: textA,
        editorialMode: args.editorialMode,
        provider,
        model,
        promptVersion: promptVer,
      }),
      ctx.runAction(internal.voiceEngine.evaluate, {
        userId: args.userId,
        orgId: args.orgId,
        postId: args.postId,
        originalText: args.originalText,
        suggestedText: textB,
        editorialMode: args.editorialMode,
        provider,
        model,
        promptVersion: promptVer,
      }),
    ])) as [VoiceEvaluationOutput, VoiceEvaluationOutput];

    // ── Score and classify initial candidates (confidence-aware) ──
    const profileConfidence = evalA.profileConfidence;

    const candidates: ScoredCandidate[] = [
      {
        index: 0,
        text: textA,
        variationKey: variationA.key,
        evaluation: evalA,
        selectionScore: computeSelectionScore(evalA.scores),
        enforcementClass: classify(
          evalA.scores.combinedScore,
          evalA.scores.semanticScore,
          mode,
          profileConfidence
        ),
        phase: "initial",
        isFallback: false,
      },
      {
        index: 1,
        text: textB,
        variationKey: variationB.key,
        evaluation: evalB,
        selectionScore: computeSelectionScore(evalB.scores),
        enforcementClass: classify(
          evalB.scores.combinedScore,
          evalB.scores.semanticScore,
          mode,
          profileConfidence
        ),
        phase: "initial",
        isFallback: false,
      },
    ];

    // Find the best initial candidate
    const sortedInitial = [...candidates].sort(
      (a, b) => b.selectionScore - a.selectionScore
    );
    const bestInitial = sortedInitial[0];
    const initialEnforcementClass = bestInitial.enforcementClass;
    const initialBestCombined = bestInitial.evaluation.scores.combinedScore;
    const initialBestSemantic = bestInitial.evaluation.scores.semanticScore;

    // ══════════════════════════════════════════════════════════
    // PHASE 2: Enforcement check
    // ══════════════════════════════════════════════════════════

    let retryAttempted = false;
    let returnedOriginal = false;

    if (
      requiresEnforcement(initialEnforcementClass) &&
      bestInitial.evaluation.enforced
    ) {
      // ════════════════════════════════════════════════════════
      // PHASE 3: Enforcement retry — exactly once
      // ════════════════════════════════════════════════════════

      retryAttempted = true;

      const enforcementPrompts = buildEnforcementPrompts(
        initialEnforcementClass,
        basePrompt,
        bestInitial.evaluation.profileFingerprint,
        mode,
        variationA,
        variationB
      );

      const enforcementTemp = getEnforcementTemperature(
        modeConfig.modelConfig.temperature,
        initialEnforcementClass
      );

      const [retryTextA, retryTextB] = await Promise.all([
        callModel({
          provider,
          model,
          systemPrompt: enforcementPrompts.promptA,
          userPrompt: args.originalText,
          temperature: enforcementTemp,
        }),
        callModel({
          provider,
          model,
          systemPrompt: enforcementPrompts.promptB,
          userPrompt: args.originalText,
          temperature: enforcementTemp,
        }),
      ]);

      const [retryEvalA, retryEvalB] = (await Promise.all([
        ctx.runAction(internal.voiceEngine.evaluate, {
          userId: args.userId,
          orgId: args.orgId,
          postId: args.postId,
          originalText: args.originalText,
          suggestedText: retryTextA,
          editorialMode: args.editorialMode,
          provider,
          model,
          promptVersion: promptVer,
        }),
        ctx.runAction(internal.voiceEngine.evaluate, {
          userId: args.userId,
          orgId: args.orgId,
          postId: args.postId,
          originalText: args.originalText,
          suggestedText: retryTextB,
          editorialMode: args.editorialMode,
          provider,
          model,
          promptVersion: promptVer,
        }),
      ])) as [VoiceEvaluationOutput, VoiceEvaluationOutput];

      const nextIndex = candidates.length;
      candidates.push(
        {
          index: nextIndex,
          text: retryTextA,
          variationKey: `${variationA.key}_enforced`,
          evaluation: retryEvalA,
          selectionScore: computeSelectionScore(retryEvalA.scores),
          enforcementClass: classify(
            retryEvalA.scores.combinedScore,
            retryEvalA.scores.semanticScore,
            mode,
            profileConfidence
          ),
          phase: "enforcement_retry",
          isFallback: false,
        },
        {
          index: nextIndex + 1,
          text: retryTextB,
          variationKey: `${variationB.key}_enforced`,
          evaluation: retryEvalB,
          selectionScore: computeSelectionScore(retryEvalB.scores),
          enforcementClass: classify(
            retryEvalB.scores.combinedScore,
            retryEvalB.scores.semanticScore,
            mode,
            profileConfidence
          ),
          phase: "enforcement_retry",
          isFallback: false,
        }
      );

      // Check if ANY candidate now passes
      const anyPasses = candidates.some(
        (c) => c.enforcementClass === "pass"
      );

      if (!anyPasses) {
        returnedOriginal = true;
      }
    }

    // ══════════════════════════════════════════════════════════
    // PHASE 4: Select winner from full pool
    // ══════════════════════════════════════════════════════════

    let winner: ScoredCandidate;
    let fallbackUsed = false;

    if (returnedOriginal) {
      // All candidates failed — we will return original text.
      // Still pick the "best" candidate for storage purposes.
      const sorted = [...candidates].sort(
        (a, b) => b.selectionScore - a.selectionScore
      );
      winner = sorted[0];
      fallbackUsed = true;
    } else {
      // Pick the best passing candidate
      const passing = candidates
        .filter((c) => c.enforcementClass === "pass")
        .sort((a, b) => b.selectionScore - a.selectionScore);

      if (passing.length > 0) {
        winner = passing[0];
      } else {
        // No passes (enforcement not active) — pick highest scorer
        const sorted = [...candidates].sort(
          (a, b) => b.selectionScore - a.selectionScore
        );
        winner = sorted[0];
      }
    }

    // ══════════════════════════════════════════════════════════
    // PHASE 5: Determine enforcement outcome
    // ══════════════════════════════════════════════════════════

    let enforcementOutcome: EnforcementOutcome;

    if (!bestInitial.evaluation.enforced) {
      // No active profile — enforcement didn't trigger
      enforcementOutcome = "pass";
    } else if (returnedOriginal) {
      enforcementOutcome = "original_returned";
    } else {
      enforcementOutcome = determineOutcome(
        initialEnforcementClass,
        winner.enforcementClass
      );
    }

    const allPassed = candidates.every(
      (c) => c.enforcementClass === "pass"
    );
    const bestPassingIdx = candidates.find(
      (c) => c.enforcementClass === "pass"
    )
      ? candidates
          .filter((c) => c.enforcementClass === "pass")
          .sort((a, b) => b.selectionScore - a.selectionScore)[0].index
      : undefined;

    // ══════════════════════════════════════════════════════════
    // PHASE 6: Persist everything
    // ══════════════════════════════════════════════════════════

    await ctx.runMutation(internal.editorialRuns.supersedePriorRuns, {
      postId: args.postId,
      editorialMode: args.editorialMode,
    });

    const runId = await ctx.runMutation(
      internal.editorialRuns.createRun,
      {
        userId: args.userId,
        orgId: args.orgId,
        postId: args.postId,
        editorialMode: args.editorialMode,
        originalText: args.originalText,
        variationSeed: args.variationSeed,
        candidateCount: candidates.length,
        selectedCandidateIndex: winner.index,
        bestPassingIndex: bestPassingIdx,
        allCandidatesPassed: allPassed,
        fallbackUsed,
        enforcementClass: initialEnforcementClass,
        enforcementOutcome,
        retryAttempted,
        returnedOriginal,
        initialBestCombinedScore: initialBestCombined,
        initialBestSemanticScore: initialBestSemantic,
        finalBestCombinedScore: winner.evaluation.scores.combinedScore,
        finalBestSemanticScore: winner.evaluation.scores.semanticScore,
        provider,
        model,
        promptVersion: promptVer,
        nudgeDirection: args.nudgeDirection,
        scratchpadSnapshot: args.scratchpadContent,
      }
    );

    for (const c of candidates) {
      const isWinner = c.index === winner.index && !returnedOriginal;
      await ctx.runMutation(internal.editorialRuns.addCandidate, {
        runId,
        candidateIndex: c.index,
        variationKey: c.variationKey,
        suggestedText: c.text,
        evaluationId: c.evaluation.evaluationId ?? undefined,
        semanticScore: c.evaluation.scores.semanticScore,
        stylisticScore: c.evaluation.scores.stylisticScore,
        scopeScore: c.evaluation.scores.scopeScore,
        combinedScore: c.evaluation.scores.combinedScore,
        selectionScore: c.selectionScore,
        passed: c.enforcementClass === "pass",
        selected: isWinner,
        shown: isWinner,
        isFallback: c.isFallback,
        generationPhase: c.phase,
        enforcementClass: c.enforcementClass,
      });
    }

    // ── Cross-run drift & explainability (Phase 14.5) ─────────────────────
    await ctx.runMutation(internal.voiceRunMetrics.recordRunMetrics, {
      runId,
      userId: args.userId,
      orgId: args.orgId,
      editorialMode: args.editorialMode,
      provider,
      model,
      promptVersion: promptVer,
      semanticScore: winner.evaluation.scores.semanticScore,
      stylisticScore: winner.evaluation.scores.stylisticScore,
      combinedScore: winner.evaluation.scores.combinedScore,
      profileConfidence: winner.evaluation.profileConfidence ?? undefined,
      enforcementClass: winner.enforcementClass,
    });

    await ctx.runMutation(internal.voiceRunExplainability.recordRunExplainability, {
      runId,
      userId: args.userId,
      orgId: args.orgId,
      originalFingerprint: winner.evaluation.originalFingerprint as Record<string, unknown>,
      suggestionFingerprint: winner.evaluation.suggestionFingerprint as Record<string, unknown>,
      profileFingerprint: winner.evaluation.profileFingerprint
        ? (winner.evaluation.profileFingerprint as Record<string, unknown>)
        : undefined,
      semanticScore: winner.evaluation.scores.semanticScore,
      enforcementClass: winner.enforcementClass,
      editorialMode: args.editorialMode,
    });

    // Drift check (non-blocking; runs in background)
    ctx.runAction(internal.voiceRunMetrics.runDriftCheck, {
      userId: args.userId,
    }).catch(() => {});

    // ══════════════════════════════════════════════════════════
    // PHASE 7: Build result
    // ══════════════════════════════════════════════════════════

    const outputText = returnedOriginal
      ? args.originalText
      : winner.text;

    const hasAlternate =
      !returnedOriginal &&
      candidates.filter(
        (c) => c.index !== winner.index && c.enforcementClass === "pass"
      ).length > 0;

    const showDebug = process.env.VOICE_ENGINE_DEBUG === "true";

    const result: MultiCandidateResult = {
      originalText: args.originalText,
      suggestedText: outputText,
      mode,
      provider,
      model,
      promptVersion: promptVer,
      runId,
      candidateIndex: returnedOriginal ? -1 : winner.index,
      hasAlternate,
      totalCandidates: candidates.length,
      fallbackUsed,
      returnedOriginal,
      enforcementClass: initialEnforcementClass,
      enforcementOutcome,
    };

    if (showDebug) {
      result.voiceEvaluation = {
        scores: winner.evaluation.scores,
        selectionScore: winner.selectionScore,
        passed: winner.enforcementClass === "pass",
        enforced: winner.evaluation.enforced,
        profileStatus: winner.evaluation.profileStatus,
      };
    }

    return result;
  },
});

// ── Enforcement prompt construction ──────────────────────────────────────

function buildEnforcementPrompts(
  enforcementClass: EnforcementClass,
  basePrompt: string,
  profileFingerprint: VoiceFingerprint | null,
  mode: "developmental" | "line",
  variationA: { key: string; suffix: string },
  variationB: { key: string; suffix: string }
): { promptA: string; promptB: string } {
  switch (enforcementClass) {
    case "soft_warning": {
      // Append stylistic tightening to the base prompt (preserves variation)
      const enforcement = buildSoftWarningEnforcement(
        profileFingerprint,
        mode
      );
      return {
        promptA: basePrompt + "\n\n" + variationA.suffix + enforcement,
        promptB: basePrompt + "\n\n" + variationB.suffix + enforcement,
      };
    }

    case "failure": {
      // Replace the entire prompt with strict preservation
      const enforcement = buildFailureEnforcement(mode);
      return {
        promptA: enforcement,
        promptB: enforcement,
      };
    }

    case "drift": {
      // Append meaning preservation to the base prompt
      const enforcement = buildDriftEnforcement(mode);
      return {
        promptA: basePrompt + "\n\n" + variationA.suffix + enforcement,
        promptB: basePrompt + "\n\n" + variationB.suffix + enforcement,
      };
    }

    default:
      return {
        promptA: basePrompt + "\n\n" + variationA.suffix,
        promptB: basePrompt + "\n\n" + variationB.suffix,
      };
  }
}

// ── Try-again: swap or regenerate ────────────────────────────────────────

export const tryAgain = internalAction({
  args: {
    runId: v.id("editorialRuns"),
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<MultiCandidateResult> => {
    const run = await ctx.runQuery(internal.editorialRuns.getRun, {
      runId: args.runId,
    });
    if (!run) throw new Error("Run not found");
    if (run.userId !== args.userId) throw new Error("Access denied");
    if (run.status === "superseded") {
      throw new Error(
        "This run has been superseded. Start a new refinement."
      );
    }

    // If the run returned original text, skip swap — regenerate fresh
    if (run.returnedOriginal) {
      return (await ctx.runAction(internal.multiCandidate.generate, {
        userId: run.userId,
        orgId: run.orgId,
        postId: run.postId,
        originalText: run.originalText,
        editorialMode: run.editorialMode,
        variationSeed: run.variationSeed + 1,
        nudgeDirection: run.nudgeDirection,
        scratchpadContent: run.scratchpadSnapshot,
      })) as MultiCandidateResult;
    }

    // Find unshown candidates that passed enforcement
    const allCandidates = await ctx.runQuery(
      internal.editorialRuns.getCandidates,
      { runId: args.runId }
    );

    type Candidate = Doc<"editorialCandidates">;
    const unshown = (allCandidates as Candidate[])
      .filter(
        (c: Candidate) =>
          !c.shown &&
          (c.enforcementClass === "pass" || c.enforcementClass === undefined)
      )
      .sort(
        (a: Candidate, b: Candidate) => b.selectionScore - a.selectionScore
      );

    if (unshown.length > 0) {
      const next = unshown[0];
      await ctx.runMutation(internal.editorialRuns.swapCandidate, {
        runId: args.runId,
        candidateId: next._id,
        candidateIndex: next.candidateIndex,
      });

      const remainingUnshown = unshown.length - 1;
      const showDebug = process.env.VOICE_ENGINE_DEBUG === "true";

      const result: MultiCandidateResult = {
        originalText: run.originalText,
        suggestedText: next.suggestedText,
        mode: run.editorialMode as "developmental" | "line",
        provider: run.provider,
        model: run.model,
        promptVersion: run.promptVersion,
        runId: args.runId,
        candidateIndex: next.candidateIndex,
        hasAlternate: remainingUnshown > 0,
        totalCandidates: allCandidates.length,
        fallbackUsed: next.isFallback,
        returnedOriginal: false,
        enforcementClass: (run.enforcementClass ?? "pass") as EnforcementClass,
        enforcementOutcome: (run.enforcementOutcome ??
          "pass") as EnforcementOutcome,
      };

      if (showDebug) {
        result.voiceEvaluation = {
          scores: {
            semanticScore: next.semanticScore,
            stylisticScore: next.stylisticScore,
            scopeScore: next.scopeScore,
            combinedScore: next.combinedScore,
          },
          selectionScore: next.selectionScore,
          passed: next.passed,
          enforced: true,
          profileStatus: "active",
        };
      }

      return result;
    }

    // All candidates exhausted — regenerate with new seed
    return (await ctx.runAction(internal.multiCandidate.generate, {
      userId: run.userId,
      orgId: run.orgId,
      postId: run.postId,
      originalText: run.originalText,
      editorialMode: run.editorialMode,
      variationSeed: run.variationSeed + 1,
      nudgeDirection: run.nudgeDirection,
      scratchpadContent: run.scratchpadSnapshot,
    })) as MultiCandidateResult;
  },
});
