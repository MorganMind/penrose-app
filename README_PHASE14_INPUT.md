# Phase 14: Multi-Variant Generation, Scoring, and Deterministic Winner Selection

Complete verbatim contents of the **only files that need to be edited** to implement multi-variant line edits: generate N candidates, score each, pick the winner deterministically.

**Files to edit:** `convex/ai.ts`, `convex/voiceEngine.ts`

**Existing infrastructure (use as-is, no edits):** `voiceScoring`, `voiceFingerprint`, `voiceThresholds`, `voiceCorrection`, `embeddings`, `voiceProfiles`, `voiceEvaluations`, `aiClient`, `prompts`, `nudges`.

---

## Implementation Summary

| Change | File | Purpose |
|--------|------|---------|
| Add `record?: boolean` to `evaluate` | voiceEngine.ts | Score candidates without persisting; only record the winner |
| Generate N candidates, score each, pick winner | ai.ts | Multi-variant orchestration in `runRefinement` |

**Winner selection:** Deterministic. For example: highest `combinedScore`, or first candidate that `passesThresholds`, or a stable tie-breaker (e.g. first by index). No randomness.

---

## 1. convex/ai.ts

```ts
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

// ── Types ────────────────────────────────────────────────────────────────────

type RefinementResult = {
  originalText: string;
  suggestedText: string;
  mode: EditorialMode;
  provider: string;
  model: string;
  promptVersion: string;
  voiceEvaluation?: {
    scores: {
      semanticScore: number;
      stylisticScore: number;
      scopeScore: number;
      combinedScore: number;
    };
    passed: boolean;
    enforced: boolean;
    profileStatus: string;
    correctionApplied?: CorrectionType;
  };
};

// ── Shared refinement logic ──────────────────────────────────────────────────

async function runRefinement(
  ctx: ActionCtx,
  args: { postId?: Id<"posts">; text?: string },
  mode: EditorialMode,
  nudgeDirection?: NudgeDirection
): Promise<RefinementResult> {
  const userInfo = await ctx.runQuery(api.users.whoami, {});
  if (!userInfo || typeof userInfo !== "object" || !("userId" in userInfo)) {
    throw new Error("Unauthenticated");
  }
  const userId = (userInfo as { userId: Id<"users"> }).userId;

  let sourceText: string;
  let orgId: Id<"orgs"> | undefined;
  let scratchpad: string | null = null;

  if (args.postId) {
    const post = await ctx.runQuery(api.posts.getPost, {
      postId: args.postId,
    });
    if (!post || typeof post !== "object" || !("orgId" in post)) {
      throw new Error("Post not found or access denied");
    }
    const postObj = post as { orgId: Id<"orgs">; body: string | null; status: string };

    if (postObj.status !== "draft" && postObj.status !== "scheduled") {
      throw new Error(
        "Editorial passes may only run on draft or scheduled posts. " +
          "Return the post to draft status first."
      );
    }

    sourceText = postObj.body ?? "";
    orgId = postObj.orgId;

    try {
      const pref = await ctx.runQuery(api.voicePreferences.getForOrg, {
        orgId: postObj.orgId,
      });
      if (pref && typeof pref === "object" && "content" in pref && pref.content) {
        scratchpad = pref.content as string;
      }
    } catch {
      // Preferences are optional
    }
  } else if (args.text) {
    sourceText = args.text;
    const ui = userInfo as { orgs?: { orgId: Id<"orgs"> }[] };
    if (ui.orgs && ui.orgs.length > 0) {
      orgId = ui.orgs[0].orgId;
    }
  } else {
    throw new Error("Either postId or text must be provided");
  }

  if (!sourceText.trim()) {
    throw new Error("Cannot refine empty content");
  }

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
    userId,
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
    correctionApplied = await runCorrectionPipeline(
      ctx,
      {
        sourceText,
        evaluation,
        mode,
        baseSystemPrompt: systemPrompt,
        provider,
        model,
        modeConfig,
      },
      (text) => {
        suggestedText = text;
      }
    );
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

// ── Corrective pipeline ──────────────────────────────────────────────────────

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
  },
  setSuggestion: (text: string) => void
): Promise<CorrectionType> {
  const {
    sourceText,
    evaluation,
    mode,
    baseSystemPrompt,
    provider,
    model,
    modeConfig,
  } = params;

  const constraintSuffix = buildConstraintBoostSuffix(
    evaluation.scores,
    evaluation.thresholds,
    evaluation.profileFingerprint,
    mode
  );

  const boostedPrompt = baseSystemPrompt + constraintSuffix;

  const boostedSuggestion = (await callModel({
    provider,
    model,
    systemPrompt: boostedPrompt,
    userPrompt: sourceText,
    temperature: Math.max(0.1, modeConfig.modelConfig.temperature - 0.1),
  })) as string;

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

  const minimalPrompt = buildMinimalEditPrompt(mode);

  const minimalSuggestion = (await callModel({
    provider,
    model,
    systemPrompt: minimalPrompt,
    userPrompt: sourceText,
    temperature: 0.1,
  })) as string;

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
): {
  semanticScore: number;
  stylisticScore: number;
  scopeScore: number;
  combined: number;
} {
  const origFp = extractFingerprint(originalText);
  const sugFp = extractFingerprint(suggestionText);

  const semanticScore = semanticHeuristicPenalty(
    originalText,
    suggestionText
  );

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
  handler: async (ctx, args) => runRefinement(ctx, args, "developmental"),
});

export const refineLine = action({
  args: refineArgs,
  handler: async (ctx, args) => runRefinement(ctx, args, "line"),
});

export const refineLineWithText = action({
  args: {
    text: v.string(),
    nudgeDirection: v.optional(v.string()),
  },
  handler: async (ctx, { text, nudgeDirection }) =>
    runRefinement(ctx, { text }, "line", nudgeDirection as NudgeDirection),
});

export const refineCopy = action({
  args: refineArgs,
  handler: async (ctx, args) => runRefinement(ctx, args, "copy"),
});

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
    return runRefinement(
      ctx,
      { postId },
      mode as EditorialMode,
      nudgeDirection as NudgeDirection
    );
  },
});
```

---

## 2. convex/voiceEngine.ts

```ts
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

    const profile = await ctx.runQuery(
      internal.voiceProfiles.getProfileInternal,
      {
        userId: args.userId,
        orgId: args.orgId,
      }
    );

    const profileStatus: "none" | "building" | "active" = profile
      ? profile.status
      : "none";

    const profileFingerprint: VoiceFingerprint | null = profile
      ? (profile.fingerprint as VoiceFingerprint)
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

    const stylisticTarget = profileFingerprint ?? originalFingerprint;
    const stylisticScore = computeStylisticScore(
      suggestionFingerprint,
      stylisticTarget
    );

    const scopeScore = computeScopeScore(
      originalFingerprint,
      suggestionFingerprint,
      mode
    );

    const combinedScore = computeCombinedScore(
      { semanticScore, stylisticScore, scopeScore },
      mode
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
      scores: {
        semanticScore,
        stylisticScore,
        scopeScore,
        combinedScore,
      },
      thresholds,
      passed: enforced ? passed : true,
      enforced,
      profileStatus,
      originalFingerprint,
      suggestionFingerprint,
      profileFingerprint,
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
      const result = blendFingerprints(
        profile.fingerprint as VoiceFingerprint,
        fingerprint,
        profile.sampleCount
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
```

---

## 3. Where to attach multi-variant orchestration

**In `ai.ts` `runRefinement`**, replace the single-call flow:

```ts
let suggestedText = await callModel({ ... });
const evaluation = await ctx.runAction(internal.voiceEngine.evaluate, { ... });
```

with:

1. **Generate N candidates** — call `callModel` N times (e.g. `Promise.all` with different seeds/temperatures, or sequential). Each call returns one suggestion.
2. **Score each candidate** — call `internal.voiceEngine.evaluate` with `record: false` for each candidate. Store `{ suggestedText, evaluation }`.
3. **Pick winner** — deterministic: e.g. highest `combinedScore`, or first that `passesThresholds`, with ties broken by index.
4. **Record winner** — call `evaluate` again with `record: true` for the winner only, OR add a separate `recordEvaluation` action that takes the evaluation result and persists it.
5. **Run correction** — if winner fails and `evaluation.enforced`, run `runCorrectionPipeline` on the winner as today.

**In `voiceEngine.ts` `evaluate`**, add `record?: boolean` (default `true`). When `record === false`, skip the `recordEvaluation` mutation and return `evaluationId: null`.
