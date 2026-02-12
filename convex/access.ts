import { QueryCtx, MutationCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id, Doc } from "./_generated/dataModel";

/**
 * Role definitions for organization membership.
 * Ordered from highest to lowest privilege for reference.
 */
export const ROLES = ["owner", "admin", "editor", "author", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Ensure the request is from an authenticated user.
 * 
 * @throws Error if user is not authenticated
 * @returns The authenticated user's ID
 * 
 * Usage:
 *   const userId = await requireUser(ctx);
 */
export async function requireUser(
  ctx: QueryCtx | MutationCtx
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  
  if (!userId) {
    throw new Error("Unauthorized: Authentication required");
  }
  
  return userId;
}

/**
 * Verify the authenticated user is a member of the specified organization.
 * 
 * @throws Error if user is not authenticated
 * @throws Error if user is not a member of the organization
 * @returns Object containing userId and the membership document
 * 
 * Usage:
 *   const { userId, membership } = await requireOrgMember(ctx, orgId);
 */
export async function requireOrgMember(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"orgs">
): Promise<{ userId: Id<"users">; membership: Doc<"orgMembers"> }> {
  const userId = await requireUser(ctx);

  const membership = await ctx.db
    .query("orgMembers")
    .withIndex("by_org_and_user", (q) =>
      q.eq("orgId", orgId).eq("userId", userId)
    )
    .unique();

  if (!membership) {
    throw new Error(
      "Forbidden: You are not a member of this organization"
    );
  }

  return { userId, membership };
}

/**
 * Verify the authenticated user has one of the allowed roles in the organization.
 * 
 * @param ctx - Query or mutation context
 * @param orgId - The organization to check membership in
 * @param allowedRoles - Array of roles that are permitted for this operation
 * 
 * @throws Error if user is not authenticated
 * @throws Error if user is not a member of the organization
 * @throws Error if user's role is not in the allowedRoles array
 * @returns Object containing userId and the membership document
 * 
 * Usage:
 *   // Only owners and admins can delete
 *   const { userId, membership } = await requireRole(ctx, orgId, ["owner", "admin"]);
 *   
 *   // Authors and above can create posts
 *   const { userId } = await requireRole(ctx, orgId, ["owner", "admin", "editor", "author"]);
 */
export async function requireRole(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"orgs">,
  allowedRoles: Role[]
): Promise<{ userId: Id<"users">; membership: Doc<"orgMembers"> }> {
  const { userId, membership } = await requireOrgMember(ctx, orgId);

  if (!allowedRoles.includes(membership.role)) {
    throw new Error(
      `Forbidden: This action requires one of these roles: ${allowedRoles.join(", ")}. Your role: ${membership.role}`
    );
  }

  return { userId, membership };
}
