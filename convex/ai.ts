"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { EDITORIAL_MODES, EditorialMode } from "./lib/prompts";

// ── Provider abstraction ─────────────────────────────────────────────────────

type ModelParams = {
  provider: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
};

async function callModel(params: ModelParams): Promise<string> {
  const { provider, model, systemPrompt, userPrompt } = params;

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set. Run: npx convex env set OPENAI_API_KEY sk-..."
      );
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
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
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

// ── Shared refinement logic ──────────────────────────────────────────────────

/**
 * Core refinement handler shared by all three editorial actions.
 *
 * When postId is supplied:
 *   - Verifies authentication and org membership (via getPost)
 *   - Enforces that the post is in an editable status (draft | scheduled)
 *   - Reads the body from the active revision (post.body)
 *
 * When text is supplied directly:
 *   - Verifies authentication only
 *   - Uses the provided text as-is
 *
 * Returns the suggestion without persisting anything.
 */
type RefinementResult = {
  originalText: string;
  suggestedText: string;
  mode: EditorialMode;
  provider: string;
  model: string;
};

async function runRefinement(
  ctx: { runQuery: (query: any, args: any) => Promise<any> },
  args: { postId?: string; text?: string },
  mode: EditorialMode
): Promise<RefinementResult> {
  const userInfo = await ctx.runQuery(api.users.whoami, {});
  if (!userInfo) throw new Error("Unauthenticated");

  let sourceText: string;

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

  const suggestedText = await callModel({
    provider,
    model,
    systemPrompt: modeConfig.systemPrompt,
    userPrompt: sourceText,
  });

  return {
    originalText: sourceText,
    suggestedText,
    mode,
    provider,
    model,
  };
}

// ── Public actions ───────────────────────────────────────────────────────────

const refineArgs = {
  postId: v.optional(v.id("posts")),
  text: v.optional(v.string()),
};

/**
 * Developmental editing pass.
 * Focuses on structure, argument, coherence, and content gaps.
 */
export const refineDevelopmental = action({
  args: refineArgs,
  handler: async (ctx, args) => runRefinement(ctx, args, "developmental"),
});

/**
 * Line editing pass.
 * Focuses on sentence craft, word choice, rhythm, and transitions.
 */
export const refineLine = action({
  args: refineArgs,
  handler: async (ctx, args) => runRefinement(ctx, args, "line"),
});

/**
 * Copy editing pass.
 * Focuses on grammar, spelling, punctuation, and style consistency.
 */
export const refineCopy = action({
  args: refineArgs,
  handler: async (ctx, args) => runRefinement(ctx, args, "copy"),
});
