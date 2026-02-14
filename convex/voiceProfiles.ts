import {
  query,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { v } from "convex/values";
import { requireOrgMember } from "./access";
import {
  computeConfidence,
  type SourceTypeCounts,
} from "./lib/profileConfidence";

// ── Validators ───────────────────────────────────────────────────────────

const sourceTypeV = v.union(
  v.literal("published_post"),
  v.literal("manual_revision"),
  v.literal("initial_draft"),
  v.literal("baseline_sample")
);

// ── Queries ──────────────────────────────────────────────────────────────

export const getProfile = query({
  args: {
    userId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
  },
  handler: async (ctx, { userId, orgId }) => {
    if (orgId) {
      await requireOrgMember(ctx, orgId);
      const orgProfile = await ctx.db
        .query("voiceProfiles")
        .withIndex("by_org_and_user", (q) =>
          q.eq("orgId", orgId).eq("userId", userId)
        )
        .first();
      if (orgProfile) return orgProfile;
    }

    return await ctx.db
      .query("voiceProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("orgId"), undefined))
      .first();
  },
});

export const getProfileStatus = query({
  args: {
    userId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
  },
  handler: async (ctx, { userId, orgId }) => {
    if (orgId) {
      await requireOrgMember(ctx, orgId);
      const profile = await ctx.db
        .query("voiceProfiles")
        .withIndex("by_org_and_user", (q) =>
          q.eq("orgId", orgId).eq("userId", userId)
        )
        .first();
      if (profile) {
        return {
          exists: true,
          status: profile.status,
          sampleCount: profile.sampleCount,
          totalWordCount: profile.totalWordCount,
          confidence: profile.confidence ?? 0,
          confidenceBand: (profile.confidenceBand ?? "low") as "low" | "medium" | "high",
          confidenceComponents: profile.confidenceComponents ?? null,
          lastSampleAt: profile.lastSampleAt,
        };
      }
    }

    const profile = await ctx.db
      .query("voiceProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("orgId"), undefined))
      .first();

    if (!profile) {
      return {
        exists: false,
        status: "none" as const,
        sampleCount: 0,
        totalWordCount: 0,
        confidence: 0,
        confidenceBand: "low" as const,
        confidenceComponents: null,
        lastSampleAt: null,
      };
    }

    return {
      exists: true,
      status: profile.status,
      sampleCount: profile.sampleCount,
      totalWordCount: profile.totalWordCount,
      confidence: profile.confidence ?? 0,
      confidenceBand: (profile.confidenceBand ?? "low") as "low" | "medium" | "high",
      confidenceComponents: profile.confidenceComponents ?? null,
      lastSampleAt: profile.lastSampleAt,
    };
  },
});

export const getProfileInternal = internalQuery({
  args: {
    userId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
  },
  handler: async (ctx, { userId, orgId }) => {
    if (orgId) {
      const orgProfile = await ctx.db
        .query("voiceProfiles")
        .withIndex("by_org_and_user", (q) =>
          q.eq("orgId", orgId).eq("userId", userId)
        )
        .first();
      if (orgProfile) return orgProfile;
    }

    return await ctx.db
      .query("voiceProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("orgId"), undefined))
      .first();
  },
});

export const listSamples = query({
  args: { profileId: v.id("voiceProfiles") },
  handler: async (ctx, { profileId }) => {
    return await ctx.db
      .query("voiceProfileSamples")
      .withIndex("by_profile", (q) => q.eq("profileId", profileId))
      .order("desc")
      .collect();
  },
});

// ── Internal mutations ───────────────────────────────────────────────────

/**
 * Create or update a voice profile with a new text sample.
 *
 * This is the core profile evolution function. It:
 *  1. Receives the pre-blended fingerprint from the engine
 *  2. Updates diversity metrics from the sample metadata
 *  3. Recomputes confidence from the updated metrics
 *  4. Stores everything atomically
 *
 * Never replaces the fingerprint wholesale — the engine blends
 * before calling this mutation.
 */
export const contributeSample = internalMutation({
  args: {
    userId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
    fingerprint: v.any(),
    sampleFingerprint: v.any(),
    sourceType: sourceTypeV,
    sourceId: v.optional(v.string()),
    wordCount: v.number(),
    blendAlpha: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const MIN_SAMPLES = 3;

    // ── Find existing profile ──────────────────────────────
    let profile;
    if (args.orgId) {
      profile = await ctx.db
        .query("voiceProfiles")
        .withIndex("by_org_and_user", (q) =>
          q.eq("orgId", args.orgId).eq("userId", args.userId)
        )
        .first();
    }
    if (!profile) {
      profile = await ctx.db
        .query("voiceProfiles")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .filter((q) => q.eq(q.field("orgId"), undefined))
        .first();
    }

    const sourceType = args.sourceType as keyof SourceTypeCounts;

    if (profile) {
      // ── Update existing profile ────────────────────────────
      const newSampleCount = profile.sampleCount + 1;
      const newTotalWords = profile.totalWordCount + args.wordCount;
      const newAvgSampleWords = newTotalWords / newSampleCount;
      const newStatus =
        newSampleCount >= MIN_SAMPLES ? "active" : "building";

      // Update diversity metrics (migrate from samples if old schema)
      const samples = await ctx.db
        .query("voiceProfileSamples")
        .withIndex("by_profile", (q) => q.eq("profileId", profile!._id))
        .collect();

      let baseSourceTypeCounts: SourceTypeCounts;
      if (profile.sourceTypeCounts) {
        baseSourceTypeCounts = profile.sourceTypeCounts as SourceTypeCounts;
      } else {
        baseSourceTypeCounts = {
          published_post: 0,
          manual_revision: 0,
          initial_draft: 0,
          baseline_sample: 0,
        };
        for (const s of samples) {
          const k = s.sourceType as keyof SourceTypeCounts;
          baseSourceTypeCounts[k] =
            (baseSourceTypeCounts[k] ?? 0) + 1;
        }
      }

      const newSourceTypeCounts = { ...baseSourceTypeCounts };
      newSourceTypeCounts[sourceType] =
        (newSourceTypeCounts[sourceType] ?? 0) + 1;

      const newUniqueSourceTypes = (
        Object.values(newSourceTypeCounts) as number[]
      ).filter((c) => c > 0).length;

      // Count unique posts from samples
      const postIds = new Set(
        samples
          .map((s) => s.sourceId)
          .filter((id): id is string => id != null)
      );
      if (args.sourceId) postIds.add(args.sourceId);
      const newUniquePostIds = postIds.size;

      // Recompute confidence (old profiles: use createdAt as oldestSampleAt)
      const oldestSampleAt =
        profile.oldestSampleAt ?? profile.createdAt ?? now;
      const newestSampleAt = now;
      const conf = computeConfidence(
        newTotalWords,
        newSampleCount,
        {
          uniqueSourceTypes: newUniqueSourceTypes,
          uniquePostIds: newUniquePostIds,
          sourceTypeCounts: newSourceTypeCounts as SourceTypeCounts,
          sampleCount: newSampleCount,
        },
        oldestSampleAt,
        newestSampleAt
      );

      await ctx.db.patch(profile._id, {
        fingerprint: args.fingerprint,
        sampleCount: newSampleCount,
        totalWordCount: newTotalWords,
        status: newStatus as "building" | "active",
        confidence: conf.overall,
        confidenceBand: conf.band,
        confidenceComponents: conf.components,
        uniqueSourceTypes: newUniqueSourceTypes,
        uniquePostIds: newUniquePostIds,
        sourceTypeCounts: newSourceTypeCounts as SourceTypeCounts,
        averageSampleWordCount: newAvgSampleWords,
        lastSampleAt: now,
        updatedAt: now,
      });

      // Log sample
      await ctx.db.insert("voiceProfileSamples", {
        profileId: profile._id,
        userId: args.userId,
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        fingerprint: args.sampleFingerprint,
        wordCount: args.wordCount,
        blendAlpha: args.blendAlpha,
        createdAt: now,
      });

      return profile._id;
    } else {
      // ── Create new profile from first sample ───────────────
      const initialSourceTypeCounts: SourceTypeCounts = {
        published_post: 0,
        manual_revision: 0,
        initial_draft: 0,
        baseline_sample: 0,
      };
      initialSourceTypeCounts[sourceType] = 1;

      const conf = computeConfidence(
        args.wordCount,
        1,
        {
          uniqueSourceTypes: 1,
          uniquePostIds: args.sourceId ? 1 : 0,
          sourceTypeCounts: initialSourceTypeCounts,
          sampleCount: 1,
        },
        now,
        now
      );

      const profileId = await ctx.db.insert("voiceProfiles", {
        userId: args.userId,
        orgId: args.orgId,
        fingerprint: args.fingerprint,
        sampleCount: 1,
        totalWordCount: args.wordCount,
        status: "building",
        confidence: conf.overall,
        confidenceBand: conf.band,
        confidenceComponents: conf.components,
        uniqueSourceTypes: 1,
        uniquePostIds: args.sourceId ? 1 : 0,
        sourceTypeCounts: initialSourceTypeCounts,
        oldestSampleAt: now,
        averageSampleWordCount: args.wordCount,
        lastSampleAt: now,
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.insert("voiceProfileSamples", {
        profileId,
        userId: args.userId,
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        fingerprint: args.sampleFingerprint,
        wordCount: args.wordCount,
        blendAlpha: 1.0,
        createdAt: now,
      });

      return profileId;
    }
  },
});
