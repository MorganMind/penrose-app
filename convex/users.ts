import { query } from "./_generated/server";
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

    return {
      userId,
      name: user?.name,
      email: user?.email,
      image: user?.image,
      orgs,
    };
  },
});
