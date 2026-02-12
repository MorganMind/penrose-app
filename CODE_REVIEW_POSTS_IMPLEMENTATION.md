# Code Review: Posts Implementation

## Quick Summary

**Strengths:**
- ✅ Clean separation of concerns (URL building, mutations, queries, UI)
- ✅ Proper security gates using `requireOrgMember` for authenticated operations
- ✅ Atomic org+site creation in `orgs.create` mutation
- ✅ Well-documented code with clear intent
- ✅ Efficient use of composite indexes (`by_site_and_slug`)
- ✅ Good error handling in UI components

**Risks:**
- ⚠️ **Missing role-based permissions** — `createPost` allows any org member, not just authors+
- ⚠️ **No input validation** — title/body length limits, empty string handling
- ⚠️ **Performance concerns** — no pagination for posts list, slug collision loop could be slow
- ⚠️ **Inconsistent naming** — `tenantId` vs `orgId` parameter naming
- ⚠️ **Layout still references `/pages`** — needs update to `/posts`
- ⚠️ **Missing edge case handling** — empty slug after slugify, URL building edge cases

---

## Detailed Suggestions

### 1. Correctness Issues

#### Missing Role-Based Permissions for Post Creation
**Issue:** `createPost` mutation only checks org membership, not role. According to `access.ts` comments, only "authors and above" should create posts.

**Current code:**
```typescript
const { userId } = await requireOrgMember(ctx, tenantId);
```

**Fix:**
```typescript
// Only authors, editors, admins, and owners can create posts
await requireRole(ctx, tenantId, ["owner", "admin", "editor", "author"]);
const userId = await requireUser(ctx);
```

**Impact:** Viewers could create posts, which may not be intended.

#### Empty Slug Edge Case
**Issue:** If `slugify(title)` produces an empty string (e.g., title is only special characters), the code falls back to `"untitled"`, but this could still collide.

**Current code:**
```typescript
const baseSlug = slugify(title) || "untitled";
```

**Fix:** Validate title before slugification:
```typescript
const trimmedTitle = title.trim();
if (!trimmedTitle) {
  throw new Error("Title cannot be empty");
}
const baseSlug = slugify(trimmedTitle) || "untitled";
```

#### Layout Still References Old Route
**Issue:** `app/(app)/layout.tsx` line 35 still has `/pages` instead of `/posts`.

**Fix:** Update to `/posts` as mentioned in the implementation notes.

#### URL Building Edge Cases
**Issue:** `publicPostUrl` doesn't validate inputs. Empty subdomain or postSlug could produce malformed URLs.

**Current code:**
```typescript
export function publicPostUrl(subdomain: string, postSlug: string): string {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";
  const protocol = rootDomain.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${subdomain}.${rootDomain}/p/${postSlug}`;
}
```

**Fix:** Add validation or at least document assumptions:
```typescript
export function publicPostUrl(subdomain: string, postSlug: string): string {
  if (!subdomain || !postSlug) {
    throw new Error("Subdomain and postSlug are required");
  }
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";
  const protocol = rootDomain.startsWith("localhost") ? "https" : "https";
  return `${protocol}://${subdomain}.${rootDomain}/p/${postSlug}`;
}
```

**Note:** There's also a bug in the protocol logic — it should be `http` for localhost, not `https`.

### 2. Security Issues

#### Missing Input Length Validation
**Issue:** No limits on `title` or `body` length. Could allow extremely long strings causing:
- Database storage issues
- UI rendering problems
- Potential DoS vectors

**Fix:** Add validation in `createPost`:
```typescript
const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 100000; // ~100KB

if (title.trim().length === 0) {
  throw new Error("Title cannot be empty");
}
if (title.length > MAX_TITLE_LENGTH) {
  throw new Error(`Title cannot exceed ${MAX_TITLE_LENGTH} characters`);
}
if (body.length > MAX_BODY_LENGTH) {
  throw new Error(`Body cannot exceed ${MAX_BODY_LENGTH} characters`);
}
```

#### Slug Collision DoS Potential
**Issue:** While the 99-attempt limit prevents infinite loops, an attacker could intentionally create many posts with similar titles to force collision checks.

**Mitigation:** The current approach is reasonable, but consider:
- Adding rate limiting at the mutation level
- Using UUID suffix for collisions instead of sequential numbers (harder to predict)

### 3. Performance Issues

#### No Pagination for Posts List
**Issue:** `listPostsForSite` returns all posts. For sites with hundreds/thousands of posts, this will:
- Slow down the query
- Transfer unnecessary data
- Cause UI rendering delays

**Fix:** Add pagination:
```typescript
export const listPostsForSite = query({
  args: {
    siteId: v.id("sites"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { siteId, limit = 50, cursor }) => {
    // ... membership check ...
    
    let query = ctx.db
      .query("posts")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .order("desc"); // Most recent first
    
    if (cursor) {
      // Resume from cursor
    }
    
    const posts = await query.take(limit);
    
    return {
      posts: posts.map(...),
      nextCursor: posts.length === limit ? posts[posts.length - 1]._id : null,
    };
  },
});
```

#### No Ordering in Posts List
**Issue:** Posts are returned in arbitrary order. Users expect newest-first.

**Fix:** Add `.order("desc")` on `createdAt` (requires adding `createdAt` to the index or using a different index).

#### Slug Collision Check Loop
**Issue:** The while loop queries the database on each iteration. With many collisions, this could be slow.

**Mitigation:** Current approach is fine for typical use, but consider:
- Pre-checking if base slug exists before entering loop
- Using a more sophisticated collision strategy (e.g., hash-based suffix)

### 4. Clarity & Maintainability

#### Inconsistent Parameter Naming
**Issue:** `createPost` uses `tenantId` but the schema and other code uses `orgId`. This is confusing.

**Fix:** Use `orgId` consistently:
```typescript
export const createPost = mutation({
  args: {
    orgId: v.id("orgs"), // Changed from tenantId
    siteId: v.id("sites"),
    title: v.string(),
    body: v.string(),
  },
  handler: async (ctx, { orgId, siteId, title, body }) => {
    await requireRole(ctx, orgId, ["owner", "admin", "editor", "author"]);
    // ...
  },
});
```

**Note:** This is a breaking change for any existing callers, but better to fix now.

#### Slugify Function Should Be Shared
**Issue:** `slugify` is defined inline in `posts.ts`. If other parts of the codebase need slugification, it should be extracted.

**Fix:** Move to `lib/slugify.ts` or `convex/lib/slugify.ts`:
```typescript
// convex/lib/slugify.ts
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}
```

#### Missing Status Filter in List Query
**Issue:** `listPostsForSite` returns all posts including drafts and archived. Dashboard should probably filter to published only, or at least show status.

**Fix:** Either filter in the query or add a status filter parameter:
```typescript
// Option 1: Filter to published only
const posts = await ctx.db
  .query("posts")
  .withIndex("by_site", (q) => q.eq("siteId", siteId))
  .filter((q) => q.eq(q.field("status"), "published"))
  .collect();

// Option 2: Add status to return value so UI can filter
return posts.map((post) => ({
  _id: post._id,
  title: post.title,
  slug: post.slug,
  status: post.status, // Add this
  createdAt: post.createdAt,
}));
```

### 5. Scalability Concerns

#### Multi-Site Future
**Issue:** `getSiteForOrg` comment mentions "first site" and notes multi-site support is coming. The current implementation assumes one site per org.

**Recommendation:** The current approach is fine for MVP, but document the migration path:
- When multi-site lands, `getSiteForOrg` should become `listSitesForOrg` with a site picker UI
- Consider adding a `isDefault` flag to sites table now to ease migration

#### No Soft Delete or Archive Support
**Issue:** Posts can be archived (status exists), but there's no way to archive posts from the UI, and archived posts still appear in the list.

**Recommendation:** Add archive functionality or filter archived posts from the list view.

### 6. Best Practices

#### Form Validation
**Issue:** Client-side form only checks `!title.trim()` for submit button, but doesn't prevent submission of whitespace-only titles.

**Fix:** Add validation in `handleSubmit`:
```typescript
const trimmedTitle = title.trim();
const trimmedBody = body.trim();

if (!trimmedTitle) {
  setError("Title is required");
  return;
}
```

#### Error Messages
**Issue:** Some error messages are generic ("Failed to create post"). More specific errors would help debugging.

**Fix:** Surface Convex error messages:
```typescript
} catch (err) {
  const message = err instanceof Error 
    ? err.message 
    : "Failed to create post";
  setError(message);
  setIsSubmitting(false);
}
```

#### Missing Loading States
**Issue:** The posts list page shows "Loading posts…" but the individual post items don't have skeleton states during initial load.

**Recommendation:** Add skeleton loaders for better UX.

---

## Optional Refactored Versions

### Refactored `createPost` with All Fixes

```typescript
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole, requireUser } from "./access";
import { slugify } from "./lib/slugify";

const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 100000;

export const createPost = mutation({
  args: {
    orgId: v.id("orgs"), // Consistent naming
    siteId: v.id("sites"),
    title: v.string(),
    body: v.string(),
  },
  handler: async (ctx, { orgId, siteId, title, body }) => {
    // 1. Role-based permission check
    await requireRole(ctx, orgId, ["owner", "admin", "editor", "author"]);
    const { userId } = await requireUser(ctx);

    // 2. Input validation
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();

    if (!trimmedTitle) {
      throw new Error("Title cannot be empty");
    }
    if (trimmedTitle.length > MAX_TITLE_LENGTH) {
      throw new Error(`Title cannot exceed ${MAX_TITLE_LENGTH} characters`);
    }
    if (trimmedBody.length > MAX_BODY_LENGTH) {
      throw new Error(`Body cannot exceed ${MAX_BODY_LENGTH} characters`);
    }

    // 3. Verify site belongs to this org
    const site = await ctx.db.get(siteId);
    if (!site || site.orgId !== orgId) {
      throw new Error("Site not found or does not belong to this organization");
    }

    // 4. Slug generation with per-site uniqueness
    const baseSlug = slugify(trimmedTitle) || "untitled";
    let slug = baseSlug;
    let suffix = 0;

    // Check if base slug exists before entering loop
    const baseExists = await ctx.db
      .query("posts")
      .withIndex("by_site_and_slug", (q) =>
        q.eq("siteId", siteId).eq("slug", baseSlug)
      )
      .unique();

    if (baseExists) {
      // Only enter loop if collision exists
      while (suffix < 99) {
        suffix++;
        slug = `${baseSlug}-${suffix}`;
        
        const existing = await ctx.db
          .query("posts")
          .withIndex("by_site_and_slug", (q) =>
            q.eq("siteId", siteId).eq("slug", slug)
          )
          .unique();

        if (!existing) break;
      }

      if (suffix >= 99) {
        throw new Error("Unable to generate a unique slug — too many collisions");
      }
    }

    // 5. Insert the post
    const now = Date.now();
    return await ctx.db.insert("posts", {
      orgId,
      siteId,
      title: trimmedTitle,
      slug,
      body: trimmedBody,
      status: "published",
      authorId: userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});
```

### Refactored `publicPostUrl` with Validation

```typescript
/**
 * Build the public URL for a post on a tenant site.
 *
 * @param subdomain - The site subdomain (e.g., "acme")
 * @param postSlug - The post slug (e.g., "my-first-post")
 * @returns The full URL (e.g., "https://acme.penrosepages.com/p/my-first-post")
 * @throws Error if subdomain or postSlug is empty
 *
 * Uses NEXT_PUBLIC_ROOT_DOMAIN (e.g. "penrosepages.com") in production
 * and falls back to "localhost:3000" for local development.
 *
 * Works in both server and client components because Next.js inlines
 * NEXT_PUBLIC_* vars at build time.
 */
export function publicPostUrl(subdomain: string, postSlug: string): string {
  if (!subdomain?.trim() || !postSlug?.trim()) {
    throw new Error("Subdomain and postSlug are required");
  }

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";
  const protocol = rootDomain.startsWith("localhost") ? "http" : "https";
  
  return `${protocol}://${subdomain}.${rootDomain}/p/${postSlug}`;
}
```

### Refactored Form Validation

```typescript
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setIsSubmitting(true);
  setError("");

  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();

  // Client-side validation
  if (!trimmedTitle) {
    setError("Title is required");
    setIsSubmitting(false);
    return;
  }

  try {
    await createPost({
      tenantId: org._id,
      siteId: site._id,
      title: trimmedTitle,
      body: trimmedBody,
    });
    router.push(`/app/${orgSlug}/posts`);
  } catch (err) {
    const message = err instanceof Error 
      ? err.message 
      : "Failed to create post";
    setError(message);
    setIsSubmitting(false);
  }
};
```

---

## Summary of Required Changes

**High Priority:**
1. Fix layout.tsx route from `/pages` to `/posts`
2. Add role-based permissions to `createPost` (use `requireRole`)
3. Fix protocol bug in `publicPostUrl` (http for localhost)
4. Add input validation (title/body length limits, empty checks)

**Medium Priority:**
5. Rename `tenantId` to `orgId` for consistency
6. Extract `slugify` to shared utility
7. Add ordering to posts list (newest first)
8. Add status field to posts list return value

**Low Priority (Future):**
9. Add pagination to posts list
10. Add archive/delete functionality
11. Improve error messages
12. Add skeleton loaders

---

## Testing Recommendations

1. **Test empty title edge case** — submit form with only whitespace
2. **Test slug collision** — create multiple posts with identical titles
3. **Test role permissions** — verify viewers cannot create posts (after fix)
4. **Test URL generation** — verify localhost uses http, production uses https
5. **Test long inputs** — verify length limits are enforced
6. **Test site ownership** — verify users can't create posts for sites they don't own
