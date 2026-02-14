import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// ── Shared validators ────────────────────────────────────────────────────────

const onboardingStatus = v.union(
  v.literal("not_started"),
  v.literal("in_progress"),
  v.literal("complete")
);

const editorialModeValidator = v.union(
  v.literal("developmental"),
  v.literal("line"),
  v.literal("copy")
);

/**
 * Linguistic fingerprint — the measurable voice signature.
 */
const fingerprintValidator = v.object({
  avgSentenceLength: v.number(),
  sentenceLengthVariance: v.number(),
  sentenceLengthStdDev: v.number(),
  avgParagraphLength: v.number(),
  paragraphLengthVariance: v.number(),
  punctuationFrequencies: v.object({
    comma: v.number(),
    period: v.number(),
    semicolon: v.number(),
    colon: v.number(),
    exclamation: v.number(),
    question: v.number(),
    dash: v.number(),
    ellipsis: v.number(),
    parenthetical: v.number(),
  }),
  adjectiveAdverbDensity: v.number(),
  hedgingFrequency: v.number(),
  stopwordDensity: v.number(),
  contractionFrequency: v.number(),
  questionRatio: v.number(),
  exclamationRatio: v.number(),
  repetitionIndex: v.number(),
  vocabularyRichness: v.number(),
  avgWordLength: v.number(),
  readabilityScore: v.number(),
  complexityScore: v.number(),
  lexicalSignature: v.array(
    v.object({
      word: v.string(),
      frequency: v.number(),
    })
  ),
  wordCount: v.number(),
  sentenceCount: v.number(),
  paragraphCount: v.number(),
  confidence: v.number(),
});

export default defineSchema({
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    onboardingStatus: v.optional(onboardingStatus),
    onboardingStartedAt: v.optional(v.number()),
    onboardingCompletedAt: v.optional(v.number()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  orgs: defineTable({
    name: v.string(),
    slug: v.string(),
    createdAt: v.number(),
  }).index("by_slug", ["slug"]),

  orgMembers: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    role: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("editor"),
      v.literal("author"),
      v.literal("viewer")
    ),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"])
    .index("by_org_and_user", ["orgId", "userId"]),

  sites: defineTable({
    orgId: v.id("orgs"),
    name: v.string(),
    subdomain: v.string(),
    customDomain: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_subdomain", ["subdomain"])
    .index("by_custom_domain", ["customDomain"]),

  posts: defineTable({
    orgId: v.id("orgs"),
    siteId: v.id("sites"),
    title: v.string(),
    slug: v.string(),
    body: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("scheduled"),
      v.literal("published"),
      v.literal("archived")
    ),
    authorId: v.id("users"),
    activeRevisionId: v.optional(v.id("postRevisions")),
    lastEditedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_site", ["siteId"])
    .index("by_site_and_slug", ["siteId", "slug"])
    .index("by_author", ["authorId"]),

  postRevisions: defineTable({
    postId: v.id("posts"),
    body: v.string(),
    source: v.union(
      v.literal("initial"),
      v.literal("manual"),
      v.literal("ai"),
      v.literal("restore")
    ),
    aiMetadata: v.optional(
      v.object({
        provider: v.string(),
        model: v.string(),
        operationType: v.string(),
        prompt: v.optional(v.string()),
      })
    ),
    revisionNumber: v.number(),
    createdAt: v.number(),
    authorId: v.id("users"),
  })
    .index("by_post", ["postId"])
    .index("by_post_and_revision", ["postId", "revisionNumber"]),

  // ── Voice learning ─────────────────────────────────────────────────────
  //
  // User-facing preference signals for adaptive editorial refinement.
  // voiceReactions: quality/style/voice feedback after suggestions
  // voiceNudges: directional "try again" requests (more minimal, sharper, etc.)
  // voicePreferences: tenant scratchpad with LLM-validated style hints
  //

  voiceReactions: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    postId: v.optional(v.id("posts")),
    editorialMode: editorialModeValidator,
    panelType: v.union(
      v.literal("quality"),
      v.literal("style"),
      v.literal("voice")
    ),
    reaction: v.string(),
    provider: v.string(),
    model: v.string(),
    promptVersion: v.string(),
    nudgeDirection: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_and_mode", ["orgId", "editorialMode"]),

  voiceNudges: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    postId: v.optional(v.id("posts")),
    editorialMode: editorialModeValidator,
    nudgeDirection: v.string(),
    provider: v.string(),
    model: v.string(),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_and_mode", ["orgId", "editorialMode"]),

  voicePreferences: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    content: v.string(),
    validationResult: v.optional(
      v.object({
        redundancies: v.array(v.string()),
        contradictions: v.array(v.string()),
        suggestions: v.array(v.string()),
      })
    ),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_and_user", ["orgId", "userId"]),

  // ── Voice Identity Engine ──────────────────────────────────────────────

  voiceProfiles: defineTable({
    userId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
    fingerprint: fingerprintValidator,
    sampleCount: v.number(),
    totalWordCount: v.number(),
    status: v.union(
      v.literal("building"),
      v.literal("active")
    ),

    // ── Profile-level confidence ──────────────────────────────
    // Distinct from fingerprint.confidence (extraction quality).
    // This measures how well the profile represents the author.
    // Optional for backward compatibility with existing profiles.
    confidence: v.optional(v.number()),
    confidenceBand: v.optional(
      v.union(
        v.literal("low"),
        v.literal("medium"),
        v.literal("high")
      )
    ),
    confidenceComponents: v.optional(
      v.object({
        wordConfidence: v.number(),
        sampleConfidence: v.number(),
        diversityScore: v.number(),
        temporalSpread: v.number(),
      })
    ),

    // ── Diversity tracking (denormalized for fast reads) ──────
    uniqueSourceTypes: v.optional(v.number()),
    uniquePostIds: v.optional(v.number()),
    sourceTypeCounts: v.optional(
      v.object({
        published_post: v.number(),
        manual_revision: v.number(),
        initial_draft: v.number(),
        baseline_sample: v.number(),
      })
    ),

    // ── Evolution tracking ────────────────────────────────────
    oldestSampleAt: v.optional(v.number()),
    averageSampleWordCount: v.optional(v.number()),

    lastSampleAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_org_and_user", ["orgId", "userId"])
    .index("by_confidence_band", ["confidenceBand"]),

  voiceProfileSamples: defineTable({
    profileId: v.id("voiceProfiles"),
    userId: v.id("users"),
    sourceType: v.union(
      v.literal("published_post"),
      v.literal("manual_revision"),
      v.literal("initial_draft"),
      v.literal("baseline_sample")
    ),
    sourceId: v.optional(v.string()),
    fingerprint: fingerprintValidator,
    wordCount: v.number(),
    blendAlpha: v.number(),
    createdAt: v.number(),
  })
    .index("by_profile", ["profileId"])
    .index("by_user", ["userId"]),

  voiceEvaluations: defineTable({
    userId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
    postId: v.optional(v.id("posts")),
    editorialMode: editorialModeValidator,
    originalFingerprint: fingerprintValidator,
    suggestionFingerprint: fingerprintValidator,
    profileFingerprint: v.optional(fingerprintValidator),
    profileStatus: v.union(
      v.literal("none"),
      v.literal("building"),
      v.literal("active")
    ),
    profileConfidence: v.optional(v.number()),
    profileConfidenceBand: v.optional(
      v.union(
        v.literal("low"),
        v.literal("medium"),
        v.literal("high")
      )
    ),
    semanticScore: v.number(),
    stylisticScore: v.number(),
    scopeScore: v.number(),
    combinedScore: v.number(),
    thresholds: v.object({
      semantic: v.number(),
      stylistic: v.number(),
      scope: v.number(),
      combined: v.number(),
    }),
    passed: v.boolean(),
    enforced: v.boolean(),
    correctionAttempted: v.boolean(),
    correctionType: v.optional(
      v.union(
        v.literal("constraint_boost"),
        v.literal("minimal_edit"),
        v.literal("passthrough")
      )
    ),
    correctionImprovedScore: v.optional(v.boolean()),
    finalCombinedScore: v.optional(v.number()),
    provider: v.string(),
    model: v.string(),
    promptVersion: v.string(),
    originalPreview: v.string(),
    suggestionPreview: v.string(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_org", ["orgId"])
    .index("by_post", ["postId"])
    .index("by_mode", ["editorialMode"])
    .index("by_passed", ["passed"])
    .index("by_created", ["createdAt"]),

  // ── Multi-candidate editorial runs ─────────────────────────────────────

  /**
   * Each refinement request for developmental or line editing
   * produces a run containing 2+ scored candidates.
   * Only one candidate is shown at a time. "Try again" swaps
   * to the next best before regenerating.
   */
  editorialRuns: defineTable({
    userId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
    postId: v.optional(v.id("posts")),
    editorialMode: v.union(v.literal("developmental"), v.literal("line")),

    originalText: v.string(),

    variationSeed: v.number(),
    candidateCount: v.number(),

    selectedCandidateIndex: v.number(),

    bestPassingIndex: v.optional(v.number()),
    allCandidatesPassed: v.boolean(),
    fallbackUsed: v.boolean(),

    // ── Enforcement tracking ──────────────────────────────────
    enforcementClass: v.union(
      v.literal("pass"),
      v.literal("soft_warning"),
      v.literal("failure"),
      v.literal("drift")
    ),
    enforcementOutcome: v.union(
      v.literal("pass"),
      v.literal("soft_warning_resolved"),
      v.literal("failure_resolved"),
      v.literal("drift_resolved"),
      v.literal("original_returned")
    ),
    retryAttempted: v.boolean(),
    returnedOriginal: v.boolean(),
    initialBestCombinedScore: v.optional(v.number()),
    initialBestSemanticScore: v.optional(v.number()),
    finalBestCombinedScore: v.optional(v.number()),
    finalBestSemanticScore: v.optional(v.number()),

    provider: v.string(),
    model: v.string(),
    promptVersion: v.string(),

    nudgeDirection: v.optional(v.string()),
    scratchpadSnapshot: v.optional(v.string()),

    status: v.union(
      v.literal("active"),
      v.literal("superseded")
    ),

    createdAt: v.number(),
  })
    .index("by_post_mode_status", ["postId", "editorialMode", "status"])
    .index("by_user", ["userId"])
    .index("by_created", ["createdAt"])
    .index("by_enforcement", ["enforcementClass"])
    .index("by_outcome", ["enforcementOutcome"]),

  /**
   * Individual candidate within a run.
   * Every candidate is stored regardless of whether it was selected.
   */
  editorialCandidates: defineTable({
    runId: v.id("editorialRuns"),
    candidateIndex: v.number(),
    variationKey: v.string(),
    suggestedText: v.string(),

    evaluationId: v.optional(v.id("voiceEvaluations")),

    semanticScore: v.number(),
    stylisticScore: v.number(),
    scopeScore: v.number(),
    combinedScore: v.number(),
    selectionScore: v.number(),
    passed: v.boolean(),

    selected: v.boolean(),
    shown: v.boolean(),
    isFallback: v.boolean(),

    // ── Enforcement tracking ──────────────────────────────────
    generationPhase: v.union(
      v.literal("initial"),
      v.literal("enforcement_retry")
    ),
    enforcementClass: v.optional(
      v.union(
        v.literal("pass"),
        v.literal("soft_warning"),
        v.literal("failure"),
        v.literal("drift")
      )
    ),

    createdAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_run_and_index", ["runId", "candidateIndex"])
    .index("by_run_and_phase", ["runId", "generationPhase"]),

  // ── Cross-run drift detection (Phase 14.5 Part 3) ───────────────────────
  //
  // Per-run metrics for rolling analysis. Model id and prompt version
  // stored with every run so regressions can be traced.
  //
  voiceRunMetrics: defineTable({
    runId: v.id("editorialRuns"),
    userId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
    editorialMode: editorialModeValidator,

    provider: v.string(),
    model: v.string(),
    promptVersion: v.string(),

    semanticScore: v.number(),
    stylisticScore: v.number(),
    combinedScore: v.number(),
    profileConfidence: v.optional(v.number()),

    enforcementClass: v.optional(
      v.union(
        v.literal("pass"),
        v.literal("soft_warning"),
        v.literal("failure"),
        v.literal("drift")
      )
    ),

    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_model_version", ["model", "promptVersion"])
    .index("by_run", ["runId"]),

  voiceDriftAlerts: defineTable({
    userId: v.id("users"),
    model: v.string(),
    promptVersion: v.string(),
    previousModel: v.optional(v.string()),
    previousPromptVersion: v.optional(v.string()),

    alertType: v.union(
      v.literal("similarity_drop"),
      v.literal("variance_spike"),
      v.literal("downward_trend")
    ),
    severity: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high")
    ),

    rollingAvgBefore: v.optional(v.number()),
    rollingAvgAfter: v.optional(v.number()),
    varianceBefore: v.optional(v.number()),
    varianceAfter: v.optional(v.number()),
    runCount: v.number(),

    acknowledged: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_model_version", ["model", "promptVersion"])
    .index("by_created", ["createdAt"])
    .index("by_acknowledged", ["acknowledged"]),

  voiceDeploymentConfig: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // ── Internal explainability (Phase 14.5 Part 4) ─────────────────────────
  //
  // Per-run metric influence breakdown for targeted tuning.
  //
  voiceRunExplainability: defineTable({
    runId: v.id("editorialRuns"),
    userId: v.id("users"),
    orgId: v.optional(v.id("orgs")),

    cadenceDelta: v.number(),
    punctuationDelta: v.number(),
    lexicalDensityDelta: v.number(),
    semanticDelta: v.number(),

    constraintViolations: v.array(v.string()),

    topNegativeInfluences: v.array(
      v.object({
        metric: v.string(),
        rawScore: v.number(),
        weight: v.number(),
        contribution: v.number(),
      })
    ),
    topPositiveInfluences: v.array(
      v.object({
        metric: v.string(),
        rawScore: v.number(),
        weight: v.number(),
        contribution: v.number(),
      })
    ),

    createdAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_user", ["userId"]),

  // ── Voice regression suite (calibration gating) ─────────────────────────
  //
  // Baseline distributions and run history for the regression suite.
  // Run before deploy to catch prompt/weight/model regressions.
  //
  voiceRegressionBaseline: defineTable({
    configHash: v.string(),
    createdAt: v.number(),
    createdBy: v.optional(v.string()),

    // Static scoring (good vs bad edits, no LLM)
    static: v.object({
      goodWinRate: v.number(),
      falseNegatives: v.number(),
      total: v.number(),
      meanSemanticGood: v.number(),
      meanStylisticGood: v.number(),
      meanScopeGood: v.number(),
      meanCombinedGood: v.number(),
      meanSemanticBad: v.number(),
      meanStylisticBad: v.number(),
      meanScopeBad: v.number(),
      meanCombinedBad: v.number(),
      byMode: v.optional(
        v.record(
          v.string(),
          v.object({
            goodWinRate: v.number(),
            falseNegatives: v.number(),
            total: v.number(),
          })
        )
      ),
    }),

    // Live regression (LLM output scored) — optional
    live: v.optional(
      v.object({
        meanVoiceSimilarity: v.number(),
        meanSemanticSimilarity: v.number(),
        passRate: v.number(),
        driftRate: v.number(),
        enforcementFailureRate: v.number(),
        exampleCount: v.number(),
      })
    ),
  }).index("by_created", ["createdAt"]),

  voiceRegressionRuns: defineTable({
    passed: v.boolean(),
    createdAt: v.number(),
    configHash: v.string(),
    staticOnly: v.boolean(),

    // Current run metrics (mirrors baseline shape)
    static: v.object({
      goodWinRate: v.number(),
      falseNegatives: v.number(),
      total: v.number(),
      meanSemanticGood: v.number(),
      meanStylisticGood: v.number(),
      meanScopeGood: v.number(),
      meanCombinedGood: v.number(),
    }),

    live: v.optional(
      v.object({
        meanVoiceSimilarity: v.number(),
        meanSemanticSimilarity: v.number(),
        passRate: v.number(),
        driftRate: v.number(),
        enforcementFailureRate: v.number(),
        exampleCount: v.number(),
      })
    ),

    // Gating failures (which rules failed)
    failures: v.array(
      v.object({
        rule: v.string(),
        baseline: v.number(),
        current: v.number(),
        threshold: v.string(),
      })
    ),

    failuresDetail: v.optional(v.string()),
  })
    .index("by_created", ["createdAt"])
    .index("by_passed", ["passed"]),
});
