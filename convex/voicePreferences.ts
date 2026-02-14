import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgMember } from "./access";

/**
 * Get the voice scratchpad for a tenant.
 * Returns null if no preferences have been saved.
 */
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

/**
 * Save scratchpad content (before validation).
 * Clears any previous validation result.
 */
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

/**
 * Store the LLM validation result on an existing preference doc.
 * Internal — called by the validation action.
 */
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
