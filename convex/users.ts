import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Get the current authenticated user's ID and all organization memberships.
 * Returns null if not authenticated.
 *
 * This is the canonical way to check "who am I" and "what orgs do I belong to"
 * from the client.
 */
export const whoami = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) {
      if (process.env.NODE_ENV === "development") {
        console.log("whoami: getAuthUserId returned null - token not validated");
      }
      return null;
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      console.log("whoami: User ID found in auth but not in database:", userId);
      return null;
    }

    const memberships = await ctx.db
      .query("orgMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const orgs = await Promise.all(
      memberships.map(async (membership) => {
        const org = await ctx.db.get(membership.orgId);
        return {
          orgId: membership.orgId,
          name: org?.name ?? null,
          slug: org?.slug ?? null,
          role: membership.role,
        };
      })
    );

    const onboardingStatus =
      user.onboardingStatus ?? ("not_started" as const);

    return {
      userId,
      name: user?.name,
      email: user?.email,
      image: user?.image,
      orgs,
      onboardingStatus,
      onboardingStartedAt: user.onboardingStartedAt,
      onboardingCompletedAt: user.onboardingCompletedAt,
    };
  },
});

/**
 * Mark onboarding as in progress (first keystroke or mic activation).
 */
export const setOnboardingInProgress = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthenticated");

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    const status = user.onboardingStatus ?? "not_started";
    if (status !== "not_started") return;

    await ctx.db.patch(userId, {
      onboardingStatus: "in_progress",
      onboardingStartedAt: Date.now(),
    });
  },
});

/**
 * Reset onboarding status for testing. Sets status to not_started.
 */
export const resetOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthenticated");

    await ctx.db.patch(userId, {
      onboardingStatus: "not_started",
      onboardingStartedAt: undefined,
      onboardingCompletedAt: undefined,
    });
  },
});

/**
 * Mark onboarding as complete (first successful Apply).
 */
export const setOnboardingComplete = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthenticated");

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    const status = user.onboardingStatus ?? "not_started";
    if (status === "complete") return;

    await ctx.db.patch(userId, {
      onboardingStatus: "complete",
      onboardingCompletedAt: Date.now(),
    });
  },
});
