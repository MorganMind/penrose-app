# Phase 13: Voice Identity Engine — Extraction Snapshot

Complete verbatim contents of all existing files relevant to implementing a Voice Identity Engine that scores and enforces voice preservation during editorial refinements.

**Note:** No separate files `/convex/refineLine.ts`, `/convex/refineDevelopmental.ts`, or `/convex/refineCopy.ts` exist. All refinement logic lives in `/convex/ai.ts`.

**Note:** No `/convex/_helpers/` directory exists. No embedding APIs, similarity computation, or fingerprint utilities exist in the codebase.

---

## 1. Convex schema and types

### convex/schema.ts

```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const onboardingStatus = v.union(
  v.literal("not_started"),
  v.literal("in_progress"),
  v.literal("complete")
);

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
    .index("by_site_and_slug", ["siteId", "slug"]),

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
    editorialMode: v.union(
      v.literal("developmental"),
      v.literal("line"),
      v.literal("copy")
    ),
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
    editorialMode: v.union(
      v.literal("developmental"),
      v.literal("line"),
      v.literal("copy")
    ),
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
});
```

---

## 2. Editorial refinement actions

### convex/ai.ts

```ts
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { callModel, promptVersionId } from "./lib/aiClient";
import {
  EDITORIAL_MODES,
  EditorialMode,
  augmentPromptWithPreferences,
} from "./lib/prompts";
import { NUDGE_DIRECTIONS, NudgeDirection } from "./lib/nudges";

// ── Types ────────────────────────────────────────────────────────────────────

type RefinementResult = {
  originalText: string;
  suggestedText: string;
  mode: EditorialMode;
  provider: string;
  model: string;
  promptVersion: string;
};

// ── Shared refinement logic ──────────────────────────────────────────────────

async function runRefinement(
  ctx: {
    runQuery: typeof action.prototype.runQuery;
  },
  args: { postId?: Id<"posts">; text?: string },
  mode: EditorialMode,
  nudgeDirection?: NudgeDirection
): Promise<RefinementResult> {
  const userInfo = await ctx.runQuery(api.users.whoami);
  if (!userInfo) throw new Error("Unauthenticated");

  let sourceText: string;
  let scratchpad: string | null = null;

  if (args.postId) {
    const post = await ctx.runQuery(api.posts.getPost, {
      postId: args.postId,
    });
    if (!post) throw new Error("Post not found or access denied");

    if (post.status !== "draft" && post.status !== "scheduled") {
      throw new Error(
        "Editorial passes may only run on draft or scheduled posts. " +
          "Return the post to draft status first."
      );
    }

    sourceText = post.body ?? "";

    // Fetch tenant voice preferences
    try {
      const pref = await ctx.runQuery(api.voicePreferences.getForOrg, {
        orgId: post.orgId,
      });
      if (pref?.content) scratchpad = pref.content;
    } catch {
      // Preferences are optional — don't block the edit pass
    }
  } else if (args.text) {
    sourceText = args.text;
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

  // Append nudge instruction if present
  if (nudgeDirection) {
    const nudgeConfig = NUDGE_DIRECTIONS[nudgeDirection];
    systemPrompt += `\n\nADDITIONAL DIRECTION FOR THIS PASS:\n${nudgeConfig.instruction}`;
  }

  const promptVer = promptVersionId(modeConfig.systemPrompt);

  const suggestedText = await callModel({
    provider,
    model,
    systemPrompt,
    userPrompt: sourceText,
    temperature: modeConfig.modelConfig.temperature,
  });

  return {
    originalText: sourceText,
    suggestedText,
    mode,
    provider,
    model,
    promptVersion: promptVer,
  };
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

/**
 * Refine line with optional nudge for onboarding "Try again" flow.
 * Uses text input (no post context).
 */
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

/**
 * Re-run an editorial pass with a directional nudge.
 *
 * The nudge instruction is appended to the mode prompt for this
 * invocation only. No persistent configuration changes.
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
    return runRefinement(
      ctx,
      { postId },
      mode as EditorialMode,
      nudgeDirection as NudgeDirection
    );
  },
});
```

### convex/lib/prompts.ts

```ts
/**
 * Editorial mode definitions and prompt augmentation helpers.
 *
 * Each mode has a distinct editorial lens with strict transformation
 * boundaries enforced at the prompt level.
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
  developmental: {
    label: "Developmental",
    description: "Structure, argument, coherence, content gaps",
    modelConfig: { temperature: 0.6 },
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
  line: {
    label: "Line",
    description: "Sentence craft, word choice, rhythm, transitions",
    modelConfig: { temperature: 0.4 },
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
  copy: {
    label: "Copy",
    description: "Grammar, spelling, punctuation, consistency",
    modelConfig: { temperature: 0.15 },
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

export const EDITORIAL_MODE_KEYS = Object.keys(EDITORIAL_MODES) as EditorialMode[];

export function augmentPromptWithPreferences(
  basePrompt: string,
  scratchpadContent?: string | null
): string {
  if (!scratchpadContent?.trim()) return basePrompt;

  return `${basePrompt}

AUTHOR'S STATED STYLE PREFERENCES (honor these where applicable — they reflect the author's intentional voice choices):
${scratchpadContent.trim()}`;
}
```

### convex/lib/aiClient.ts

```ts
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

export function promptVersionId(basePrompt: string): string {
  return createHash("sha256").update(basePrompt).digest("hex").slice(0, 12);
}
```

### convex/lib/nudges.ts

```ts
/**
 * Directional nudge definitions for the "Try again" variant system.
 */

export type NudgeDirection =
  | "more_minimal"
  | "more_raw"
  | "sharper"
  | "softer"
  | "more_emotional"
  | "more_dry";

export type NudgeConfig = {
  label: string;
  instruction: string;
};

export const NUDGE_DIRECTIONS: Record<NudgeDirection, NudgeConfig> = {
  more_minimal: {
    label: "More minimal",
    instruction:
      "Make the text more minimal and stripped down. Remove more unnecessary words, ornamentation, and decorative language. Favor brevity over explanation.",
  },
  more_raw: {
    label: "More raw",
    instruction:
      "Make the text feel more raw and unpolished. Preserve rough edges, imperfections, and directness that give it authentic character. Resist the urge to smooth everything out.",
  },
  sharper: {
    label: "Sharper",
    instruction:
      "Make the text sharper and more incisive. Strengthen the points, tighten the language, and make claims hit harder. Remove hedging and qualifiers where the author's intent is clear.",
  },
  softer: {
    label: "Softer",
    instruction:
      "Make the text softer and more approachable. Ease aggressive or confrontational language without losing the underlying point. Allow more breathing room between ideas.",
  },
  more_emotional: {
    label: "More emotional",
    instruction:
      "Let more emotion come through in the text. Do not manufacture emotion, but amplify what is already present. Let vulnerability, conviction, or passion show more clearly.",
  },
  more_dry: {
    label: "More dry",
    instruction:
      "Make the text drier and more matter-of-fact. Reduce emotionality, sentimentality, and ornamental language. Favor precision and understatement.",
  },
} as const;

export const NUDGE_DIRECTION_KEYS = Object.keys(NUDGE_DIRECTIONS) as NudgeDirection[];
```

---

## 3. Voice preferences and reactions

### convex/voicePreferences.ts

```ts
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgMember } from "./access";

export const getForOrg = query({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, { orgId }) => {
    const { userId } = await requireOrgMember(ctx, orgId);

    const pref = await ctx.db
      .query("voicePreferences")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", orgId).eq("userId", userId)
      )
      .first();

    return pref;
  },
});

export const saveScratchpad = mutation({
  args: {
    orgId: v.id("orgs"),
    content: v.string(),
  },
  handler: async (ctx, { orgId, content }) => {
    const { userId } = await requireOrgMember(ctx, orgId);

    const existing = await ctx.db
      .query("voicePreferences")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", orgId).eq("userId", userId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        content,
        validationResult: undefined,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("voicePreferences", {
      orgId,
      userId,
      content,
      updatedAt: Date.now(),
    });
  },
});

export const saveValidationResult = mutation({
  args: {
    prefId: v.id("voicePreferences"),
    validationResult: v.object({
      redundancies: v.array(v.string()),
      contradictions: v.array(v.string()),
      suggestions: v.array(v.string()),
    }),
  },
  handler: async (ctx, { prefId, validationResult }) => {
    const pref = await ctx.db.get(prefId);
    if (!pref) throw new Error("Preference not found");
    await requireOrgMember(ctx, pref.orgId);
    await ctx.db.patch(prefId, { validationResult });
  },
});
```

### convex/voiceReactions.ts

```ts
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgMember } from "./access";

export const submitReaction = mutation({
  args: {
    orgId: v.id("orgs"),
    postId: v.optional(v.id("posts")),
    editorialMode: v.union(
      v.literal("developmental"),
      v.literal("line"),
      v.literal("copy")
    ),
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
  },
  handler: async (ctx, args) => {
    const { userId } = await requireOrgMember(ctx, args.orgId);

    return await ctx.db.insert("voiceReactions", {
      ...args,
      userId,
      createdAt: Date.now(),
    });
  },
});

export const recordNudge = mutation({
  args: {
    orgId: v.id("orgs"),
    postId: v.optional(v.id("posts")),
    editorialMode: v.union(
      v.literal("developmental"),
      v.literal("line"),
      v.literal("copy")
    ),
    nudgeDirection: v.string(),
    provider: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireOrgMember(ctx, args.orgId);

    return await ctx.db.insert("voiceNudges", {
      ...args,
      userId,
      createdAt: Date.now(),
    });
  },
});

export const getReactionCount = query({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId);

    const reactions = await ctx.db
      .query("voiceReactions")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    return reactions.length;
  },
});
```

### convex/voiceActions.ts

```ts
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

PREFERENCES:
`;

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
```

### convex/lib/reactionPanels.ts

```ts
/**
 * Reaction panel definitions and cadence logic for voice learning.
 */

export type PanelType = "quality" | "style" | "voice";

export type ReactionOption = {
  key: string;
  label: string;
};

export type PanelConfig = {
  prompt: string;
  options: ReactionOption[];
};

export const REACTION_PANELS: Record<PanelType, PanelConfig> = {
  quality: {
    prompt: "How was this suggestion?",
    options: [
      { key: "perfect", label: "Perfect" },
      { key: "good", label: "Good" },
      { key: "dont_like", label: "Don't like it" },
    ],
  },
  style: {
    prompt: "Any style concerns?",
    options: [
      { key: "too_polished", label: "Too polished" },
      { key: "too_formal", label: "Too formal" },
      { key: "too_long", label: "Too long" },
      { key: "changed_meaning", label: "Changed meaning" },
      { key: "none", label: "No issues" },
    ],
  },
  voice: {
    prompt: "Does this sound like you?",
    options: [
      { key: "sounds_like_me", label: "Sounds just like me" },
      { key: "partly_me", label: "Partly me" },
      { key: "nothing_like_me", label: "Sounds nothing like me" },
    ],
  },
};

const PANEL_ORDER: PanelType[] = ["quality", "style", "voice"];

export function getNextPanel(
  totalReactions: number,
  answeredInSession: PanelType[],
  suggestionIndex: number
): PanelType | null {
  if (totalReactions < 10) {
    const offset = totalReactions % PANEL_ORDER.length;
    const rotated = [
      ...PANEL_ORDER.slice(offset),
      ...PANEL_ORDER.slice(0, offset),
    ];
    const next = rotated.find((p) => !answeredInSession.includes(p));
    return next ?? null;
  }

  if (totalReactions < 25) {
    return answeredInSession.includes("voice") ? null : "voice";
  }

  if (suggestionIndex % 5 === 0) {
    return answeredInSession.includes("voice") ? null : "voice";
  }

  return null;
}
```

---

## 4. Posts, users, and data access

### convex/posts.ts

```ts
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireOrgMember } from "./access";
import { slugify } from "./lib/slugify";

export type PublicPost = {
  _id: Id<"posts">;
  title: string;
  slug: string;
  body: string | null;
  createdAt: number;
};

export const createPost = mutation({
  args: {
    orgId: v.id("orgs"),
    siteId: v.id("sites"),
    title: v.string(),
    body: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, siteId, title, body }) => {
    const { userId } = await requireOrgMember(ctx, orgId);
    const site = await ctx.db.get(siteId);
    if (!site || site.orgId !== orgId) throw new Error("Site not found or does not belong to this organization");
    const baseSlug = slugify(title) || "untitled";
    let slug = baseSlug;
    let suffix = 0;
    while (true) {
      const existing = await ctx.db.query("posts").withIndex("by_site_and_slug", (q) => q.eq("siteId", siteId).eq("slug", slug)).unique();
      if (!existing) break;
      suffix++;
      if (suffix > 99) throw new Error("Unable to generate a unique slug — too many collisions");
      slug = `${baseSlug}-${suffix}`;
    }
    const now = Date.now();
    const bodyText = body ?? "";
    const postId = await ctx.db.insert("posts", {
      orgId, siteId, title, slug, body: bodyText, status: "draft",
      authorId: userId, lastEditedAt: now, createdAt: now, updatedAt: now,
    });
    const revisionId = await ctx.db.insert("postRevisions", {
      postId, body: bodyText, source: "initial", revisionNumber: 1, createdAt: now, authorId: userId,
    });
    await ctx.db.patch(postId, { activeRevisionId: revisionId });
    return postId;
  },
});

export const updatePost = mutation({
  args: {
    postId: v.id("posts"),
    title: v.string(),
    body: v.string(),
    aiSource: v.optional(v.object({
      operationType: v.string(),
      provider: v.string(),
      model: v.string(),
    })),
  },
  handler: async (ctx, { postId, title, body, aiSource }) => {
    const post = await ctx.db.get(postId);
    if (!post) throw new Error("Post not found");
    const { userId } = await requireOrgMember(ctx, post.orgId);
    const now = Date.now();
    const latestRevision = await ctx.db.query("postRevisions").withIndex("by_post_and_revision", (q) => q.eq("postId", postId)).order("desc").first();
    const revisionNumber = (latestRevision?.revisionNumber ?? 0) + 1;
    const revisionId = await ctx.db.insert("postRevisions", {
      postId, body, source: aiSource ? "ai" : "manual",
      aiMetadata: aiSource ? { provider: aiSource.provider, model: aiSource.model, operationType: aiSource.operationType } : undefined,
      revisionNumber, createdAt: now, authorId: userId,
    });
    await ctx.db.patch(postId, { title, body, activeRevisionId: revisionId, lastEditedAt: now, updatedAt: now });
  },
});

export const publishPost = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post) throw new Error("Post not found");
    await requireOrgMember(ctx, post.orgId);
    if (post.status !== "draft") throw new Error(`Cannot publish a post with status "${post.status}" — only drafts can be published`);
    await ctx.db.patch(postId, { status: "published", updatedAt: Date.now() });
  },
});

export const unpublishPost = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post) throw new Error("Post not found");
    await requireOrgMember(ctx, post.orgId);
    if (post.status !== "published") throw new Error(`Only published posts can be returned to draft. Current status: "${post.status}"`);
    await ctx.db.patch(postId, { status: "draft", updatedAt: Date.now() });
  },
});

export const getPost = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post) return null;
    await requireOrgMember(ctx, post.orgId);
    return {
      _id: post._id, orgId: post.orgId, siteId: post.siteId, title: post.title, slug: post.slug,
      body: post.body ?? null, status: post.status, activeRevisionId: post.activeRevisionId ?? null,
      lastEditedAt: post.lastEditedAt ?? post.createdAt, createdAt: post.createdAt, updatedAt: post.updatedAt,
    };
  },
});

export const listPostsForSite = query({
  args: { siteId: v.id("sites"), status: v.optional(v.union(v.literal("draft"), v.literal("scheduled"), v.literal("published"), v.literal("archived"))) },
  handler: async (ctx, { siteId, status }) => {
    const site = await ctx.db.get(siteId);
    if (!site) return [];
    await requireOrgMember(ctx, site.orgId);
    const posts = await ctx.db.query("posts").withIndex("by_site", (q) => q.eq("siteId", siteId)).collect();
    const filtered = status ? posts.filter((p) => p.status === status) : posts;
    return filtered.map((post) => ({ _id: post._id, title: post.title, slug: post.slug, status: post.status, createdAt: post.createdAt }));
  },
});

export const getPostBySlug = query({
  args: { siteId: v.id("sites"), slug: v.string() },
  handler: async (ctx, { siteId, slug }): Promise<PublicPost | null> => {
    const post = await ctx.db.query("posts").withIndex("by_site_and_slug", (q) => q.eq("siteId", siteId).eq("slug", slug)).unique();
    if (!post) return null;
    if (post.status !== "published") return null;
    return { _id: post._id, title: post.title, slug: post.slug, body: post.body ?? null, createdAt: post.createdAt };
  },
});
```

### convex/postRevisions.ts

```ts
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgMember } from "./access";

export const restoreRevision = mutation({
  args: { postId: v.id("posts"), revisionId: v.id("postRevisions") },
  handler: async (ctx, { postId, revisionId }) => {
    const post = await ctx.db.get(postId);
    if (!post) throw new Error("Post not found");
    const { userId } = await requireOrgMember(ctx, post.orgId);
    if (post.status !== "draft" && post.status !== "scheduled") throw new Error("Revision restore is only allowed on draft or scheduled posts");
    const revision = await ctx.db.get(revisionId);
    if (!revision || revision.postId !== postId) throw new Error("Revision not found for this post");
    if (revision._id === post.activeRevisionId) throw new Error("This revision is already active");
    const now = Date.now();
    const latestRevision = await ctx.db.query("postRevisions").withIndex("by_post_and_revision", (q) => q.eq("postId", postId)).order("desc").first();
    const revisionNumber = (latestRevision?.revisionNumber ?? 0) + 1;
    const newRevisionId = await ctx.db.insert("postRevisions", {
      postId, body: revision.body, source: "restore", revisionNumber, createdAt: now, authorId: userId,
    });
    await ctx.db.patch(postId, { body: revision.body, activeRevisionId: newRevisionId, lastEditedAt: now, updatedAt: now });
    return { revisionNumber };
  },
});

export const listRevisionsForPost = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post) return [];
    await requireOrgMember(ctx, post.orgId);
    const revisions = await ctx.db.query("postRevisions").withIndex("by_post_and_revision", (q) => q.eq("postId", postId)).order("desc").collect();
    return revisions.map((r) => ({
      _id: r._id, revisionNumber: r.revisionNumber, source: r.source, aiMetadata: r.aiMetadata, createdAt: r.createdAt, bodyPreview: r.body.slice(0, 120),
    }));
  },
});
```

### convex/users.ts

```ts
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const whoami = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const memberships = await ctx.db.query("orgMembers").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    const orgs = await Promise.all(memberships.map(async (membership) => {
      const org = await ctx.db.get(membership.orgId);
      return { orgId: membership.orgId, name: org?.name ?? null, slug: org?.slug ?? null, role: membership.role };
    }));
    const onboardingStatus = user.onboardingStatus ?? ("not_started" as const);
    return {
      userId, name: user?.name, email: user?.email, image: user?.image, orgs,
      onboardingStatus, onboardingStartedAt: user.onboardingStartedAt, onboardingCompletedAt: user.onboardingCompletedAt,
    };
  },
});

export const setOnboardingInProgress = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthenticated");
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");
    const status = user.onboardingStatus ?? "not_started";
    if (status !== "not_started") return;
    await ctx.db.patch(userId, { onboardingStatus: "in_progress", onboardingStartedAt: Date.now() });
  },
});

export const resetOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthenticated");
    await ctx.db.patch(userId, { onboardingStatus: "not_started", onboardingStartedAt: undefined, onboardingCompletedAt: undefined });
  },
});

export const setOnboardingComplete = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthenticated");
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");
    const status = user.onboardingStatus ?? "not_started";
    if (status === "complete") return;
    await ctx.db.patch(userId, { onboardingStatus: "complete", onboardingCompletedAt: Date.now() });
  },
});
```

### convex/onboarding.ts

```ts
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { callModel } from "./lib/aiClient";

export const createPostFromOnboarding = action({
  args: { body: v.string() },
  handler: async (ctx, { body }): Promise<{ orgSlug: string; postId: Id<"posts"> }> => {
    const userInfo = await ctx.runQuery(api.users.whoami);
    if (!userInfo) throw new Error("Unauthenticated");

    let orgId: Id<"orgs">;
    let orgSlug: string;
    let siteId: Id<"sites">;

    if (userInfo.orgs.length > 0) {
      const first = userInfo.orgs[0];
      if (!first.orgId || !first.slug) throw new Error("Invalid org data");
      orgId = first.orgId;
      orgSlug = first.slug;
      const site = await ctx.runQuery(api.sites.getSiteForOrg, { orgId });
      if (!site) throw new Error("No site configured for organization");
      siteId = site._id;
    } else {
      const slug = `workspace-${Date.now().toString(36)}`;
      const orgIdCreated = await ctx.runMutation(api.orgs.create, { name: "My workspace", slug });
      orgId = orgIdCreated;
      orgSlug = slug;
      const site = await ctx.runQuery(api.sites.getSiteForOrg, { orgId });
      if (!site) throw new Error("No site configured for organization");
      siteId = site._id;
    }

    const provider = process.env.AI_PROVIDER ?? "openai";
    const model = process.env.AI_MODEL ?? "gpt-4o-mini";

    const title = await callModel({
      provider, model,
      systemPrompt: `You are a helpful assistant. Generate a short, descriptive title for the following text. Return ONLY the title, no quotes, no punctuation at the end. Maximum 10 words.`,
      userPrompt: body.slice(0, 2000),
      temperature: 0.3,
    });

    const trimmedTitle = title.trim().slice(0, 200) || "Untitled";

    const postId = await ctx.runMutation(api.posts.createPost, { orgId, siteId, title: trimmedTitle, body });

    await ctx.runMutation(api.users.setOnboardingComplete);

    return { orgSlug, postId };
  },
});
```

---

## 5. Frontend components

### app/(app)/app/[orgSlug]/posts/[postId]/edit/page.tsx

- `SuggestionPayload`: `mode`, `originalText`, `suggestedText`, `provider`, `model`, `promptVersion`, `nudgeDirection?`
- `handleRefine(mode)` → `refineDevelopmental` / `refineLine` / `refineCopy`
- `handleNudge(direction)` → `recordNudge` + `refineWithNudge`
- `handleApplySuggestion` → sets body, `appliedAiSource`, clears suggestion
- `handleRejectSuggestion` → clears suggestion
- Passes `suggestion` to `SuggestionDiff` with `onApply`, `onReject`, `onNudge`

### app/(app)/app/[orgSlug]/posts/[postId]/edit/components/SuggestionDiff.tsx

- Two-column comparison: Current vs Suggested
- Apply / Reject buttons
- `NudgeBar` for Try again directions
- `ReactionPanel` for quality/style/voice feedback

### app/(app)/app/[orgSlug]/posts/[postId]/edit/components/ReactionPanel.tsx

- Uses `getReactionCount`, `submitReaction`
- `getNextPanel(totalReactions, answeredInSession, suggestionIndex)` drives cadence
- Options from `REACTION_PANELS` (quality, style, voice)

### app/(app)/app/[orgSlug]/posts/[postId]/edit/components/NudgeBar.tsx

- Renders `NUDGE_DIRECTION_KEYS` as buttons
- Calls `onNudge(direction)` on click

### app/(app)/app/[orgSlug]/posts/[postId]/edit/components/VoiceScratchpad.tsx

- Collapsible scratchpad for style preferences
- `saveScratchpad`, `validateScratchpad` (LLM validation)
- Displays `validationResult`: redundancies, contradictions, suggestions

### app/start/page.tsx

- Onboarding flow: text input, mic, Sharpen → suggestion → Apply or Try again
- `refineLineWithText` for onboarding (no post context)
- `createPostFromOnboarding` on Apply

---

## 6. Inventory summary

| Category | Files |
|---------|------|
| Schema | `convex/schema.ts` |
| Refinement | `convex/ai.ts` |
| Prompts | `convex/lib/prompts.ts` |
| AI client | `convex/lib/aiClient.ts` |
| Nudges | `convex/lib/nudges.ts` |
| Voice prefs | `convex/voicePreferences.ts`, `convex/voiceActions.ts` |
| Voice reactions | `convex/voiceReactions.ts`, `convex/lib/reactionPanels.ts` |
| Posts | `convex/posts.ts`, `convex/postRevisions.ts` |
| Users | `convex/users.ts`, `convex/onboarding.ts` |
| Access | `convex/access.ts` |
| Frontend | `edit/page.tsx`, `SuggestionDiff.tsx`, `ReactionPanel.tsx`, `NudgeBar.tsx`, `VoiceScratchpad.tsx`, `start/page.tsx` |

**Not present:** `convex/refineLine.ts`, `convex/refineDevelopmental.ts`, `convex/refineCopy.ts`, `convex/_helpers/`, embedding APIs, similarity/fingerprint utilities.
