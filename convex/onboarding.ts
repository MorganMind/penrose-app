"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { callModel } from "./lib/aiClient";

/**
 * Create a post draft from onboarding Apply.
 * Ensures user has an org (creates default if none), generates a title from body via AI,
 * creates the post, and returns navigation info.
 */
export const createPostFromOnboarding = action({
  args: {
    body: v.string(),
  },
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
      const orgIdCreated = await ctx.runMutation(api.orgs.create, {
        name: "My workspace",
        slug,
      });
      orgId = orgIdCreated;
      orgSlug = slug;

      const site = await ctx.runQuery(api.sites.getSiteForOrg, { orgId });
      if (!site) throw new Error("No site configured for organization");
      siteId = site._id;
    }

    const provider = process.env.AI_PROVIDER ?? "openai";
    const model = process.env.AI_MODEL ?? "gpt-4o-mini";

    const title = await callModel({
      provider,
      model,
      systemPrompt: `You are a helpful assistant. Generate a short, descriptive title for the following text. Return ONLY the title, no quotes, no punctuation at the end. Maximum 10 words.`,
      userPrompt: body.slice(0, 2000),
      temperature: 0.3,
    });

    const trimmedTitle = title.trim().slice(0, 200) || "Untitled";

    const postId = await ctx.runMutation(api.posts.createPost, {
      orgId,
      siteId,
      title: trimmedTitle,
      body,
    });

    await ctx.runMutation(api.users.setOnboardingComplete);

    return { orgSlug, postId };
  },
});
