# Code Review: Phase 11 — Internal Calibration Harness

*Referencing `CODE_REVIEW.md` guidelines.*

## Quick Summary

**Strengths:**
- ✅ Clear separation: `aiClient` shared between production and calibration, `checks` isolated
- ✅ Calibration gated by `NEXT_PUBLIC_ENABLE_CALIBRATION` — no accidental exposure
- ✅ Hooks before early returns in calibration page — no Rules of Hooks violations
- ✅ `promptVersionId` enables prompt regression tracking
- ✅ Mode-specific thresholds (`MODE_THRESHOLDS`) match editorial scope
- ✅ `requireUser` for calibration mutations — authenticated but platform-level

**Risks:**
- ⚠️ **Schema migration** — `lastEditedAt` in pasted schema is required; existing posts may lack it
- ⚠️ **Calibration API not gated** — Convex mutations remain callable when UI is disabled
- ⚠️ **Color palette** — calibration UI uses purple beyond badges/labels
- ⚠️ **Shared error state** — `runError` used for both run and create failures
- ⚠️ **Type annotation** — `runRefinement` ctx typings are fragile
- ⚠️ **Missing `convex/lib/prompts.ts`** in pasted files — required dependency

---

## Detailed Suggestions

### 1. Correctness Issues

#### Schema: `lastEditedAt` Required vs Optional

**Issue:** The pasted schema uses `lastEditedAt: v.number()` (required). The current schema has `lastEditedAt: v.optional(v.number())`. New required fields on existing tables can break queries for documents created before the migration.

**Current (pasted):**
```ts
lastEditedAt: v.number(),
```

**Recommendation:** Keep `lastEditedAt` optional for backward compatibility, or run a one-time migration to backfill all existing posts:
```ts
lastEditedAt: v.optional(v.number()),
```

`getPost` already provides a fallback (`lastEditedAt ?? post.createdAt`), so optional is safe.

---

#### Calibration Nav Link When `orgSlug` Is Falsy

**Issue:** The Calibration link is inside `{orgSlug ? (...) : ...}`. On `/app` (no org), `orgSlug` may be absent. The link `href={/app/${orgSlug}/debug/calibration}` would become `/app/undefined/debug/calibration` if `orgSlug` were ever passed incorrectly.

**Current:** The link is correctly placed inside the `orgSlug` block, so it only renders when `orgSlug` exists. No change needed, but ensure the route `/app/[orgSlug]/debug/calibration` is valid for all org slugs.

---

### 2. Security Issues

#### Calibration API Accessible When UI Disabled

**Issue:** `NEXT_PUBLIC_ENABLE_CALIBRATION` only hides the nav link and shows a "disabled" message on the page. The Convex API (`api.calibration.*`, `api.calibrationActions.runCalibration`) remains callable by any authenticated user. A client could call these directly.

**Mitigation options:**

1. **Accept as-is** — For a dev harness, this may be fine if the Convex deployment is dev-only or low-risk.
2. **Server-side gate** — Add a Convex env var and check it in mutations:
   ```ts
   // In calibration.createCase, calibration.rateRun, calibrationActions.runCalibration
   if (process.env.ENABLE_CALIBRATION !== "true") {
     throw new Error("Calibration harness is disabled");
   }
   ```
3. **Role gate** — Restrict to admins/owners:
   ```ts
   const { membership } = await requireOrgMember(ctx, someOrgId);
   if (!["owner", "admin"].includes(membership.role)) {
     throw new Error("Calibration is admin-only");
   }
   ```
   (Requires picking an org; calibration is platform-level, so this is awkward.)

**Recommendation:** Add `ENABLE_CALIBRATION` to Convex env and check it in calibration mutations for defense in depth.

---

#### Calibration Platform-Level Access

**Issue:** Any authenticated user can create cases, run calibration, and rate runs. For an internal tool, this may be intended, but it allows any user to consume AI quota and store calibration data.

**Recommendation:** Document the intended audience. If restricted to admins, add role checks (e.g., require at least one org with admin/owner role).

---

### 3. Clarity & Maintainability

#### Shared Error State (`runError`)

**Issue:** `runError` is used for:
- Run failures (`handleRun`)
- Create case failures (`handleCreateCase`)
- Rating failures (`handleRate`)

The name suggests run-specific errors. A generic name would better reflect shared use.

**Fix:**
```ts
const [error, setError] = useState("");

// In handlers:
setError(err instanceof Error ? err.message : "Run failed");
setError(err instanceof Error ? err.message : "Failed to create case");
setError(err instanceof Error ? err.message : "Failed to save rating");
```

---

#### `runRefinement` Context Type

**Issue:** The type `ctx: { runQuery: typeof action.prototype.runQuery }` is brittle. `action.prototype` may not exist or match the real `ActionCtx`.

**Fix:** Use Convex’s `ActionCtx`:
```ts
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

async function runRefinement(
  ctx: ActionCtx,
  args: { postId?: Id<"posts">; text?: string },
  mode: EditorialMode
): Promise<RefinementResult> {
  // ...
}
```

---

#### `args.postId as any` in `ai.ts`

**Issue:** The cast bypasses type safety.

**Fix:** Use the proper validator; the handler receives `args` from Convex, so types should align:
```ts
const post = await ctx.runQuery(api.posts.getPost, {
  postId: args.postId!, // Assert non-null after the postId branch
});
```
Or narrow the type before the call so `postId` is `Id<"posts">`.

---

### 4. Performance

#### No Pagination for `listCases` or `listRunsForCase`

**Issue:** Both queries return all rows. With many cases or runs, this will grow unbounded.

**Recommendation:** Add pagination for future scaling:
```ts
listCases: query({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { limit = 50, cursor }) => {
    await requireUser(ctx);
    const cases = await ctx.db
      .query("calibrationCases")
      .order("desc")
      .take((limit ?? 50) + 1);
    // ... cursor logic
  },
});
```

For an internal tool with limited usage, this is low priority.

---

### 5. Best Practices

#### Color Palette Compliance

**Issue:** `.cursorrules` restricts UI to black, white, and gray, with color allowed for badges, tags, and labels. The calibration page uses purple for:
- Sidebar ("+ New" button, form container, selected case)
- Run buttons and suggested-text panel
- Primary actions

**Allowed:** Pass/warning/fail badges (green/yellow/red) and mode badges (developmental/line/copy).

**Recommendation:** Reduce purple to status/mode badges only. Use gray for primary UI:
```ts
// Instead of: bg-purple-100 text-purple-800
className="bg-gray-100 text-gray-800"

// For badges only: keep purple for "selected" or mode indicators
```

---

#### Error Handling in `handleCreateCase`

**Issue:** `setRunError` is used for create failures. Using a shared `error` state (as above) and a single `setError` call keeps behavior consistent.

---

### 6. React / Hooks

#### Hooks Order and Early Return

**Status:** Hooks are correctly declared before the dev gate:

```tsx
const cases = useQuery(...);
const runCalibration = useAction(...);
// ... all hooks

if (process.env.NEXT_PUBLIC_ENABLE_CALIBRATION !== "true") {
  return (...);
}
```

No violations of the Rules of Hooks.

---

### 7. API Design

#### `runCalibration` Return Shape

**Status:** The return shape is clear and useful:

```ts
{
  runId,
  suggestedText,
  checks,
  provider,
  model,
  promptVersion,
}
```

The UI can show results immediately without an extra query.

---

#### `listRunsForCase` Omits `inputText`

**Status:** `inputText` is intentionally excluded to keep payloads smaller. The original input is available from the selected case. Fine as-is.

---

### 8. Missing / Implicit Dependencies

#### `convex/lib/prompts.ts`

**Issue:** The pasted implementation does not include `convex/lib/prompts.ts`, but it is imported by:
- `convex/ai.ts`
- `convex/calibrationActions.ts`
- `convex/lib/checks.ts`
- `app/.../debug/calibration/page.tsx`

The repository already has this file. Ensure the implementation doc references it and that `EDITORIAL_MODES` and `EditorialMode` stay in sync with calibration.

---

#### `listRunsForCase` Return Shape vs `run.rating`

**Issue:** The mapper returns `rating: r.rating`, but the schema defines `rating` as an optional object. The UI accesses `run.rating.voiceFidelity`, etc. If `rating` is `undefined`, this will throw.

**Fix:** Guard before use:
```tsx
{run.rating && (
  <span className="text-xs text-gray-400">
    V:{run.rating.voiceFidelity} C:{run.rating.clarityGain} M:{run.rating.modeCompliance}
  </span>
)}
```

The existing code already does this, so no change needed. Verify the mapper is consistent.

---

### 9. Checks Logic (`convex/lib/checks.ts`)

#### `checkMetaCommentary` Regex Patterns

**Status:** Patterns are reasonable for detecting meta-commentary. The `^` with `m` flag correctly matches line start. `\/` in `/^```/m` is unnecessary; backticks do not need escaping in character classes, but the pattern is not in a character class, so it is fine.

---

#### `promptVersionId` Collisions

**Status:** The hash is non-cryptographic; collisions are possible but acceptable for grouping runs by prompt. The comment documents this. No change needed.

---

### 10. Schema Consistency

#### `calibrationCases` vs `calibrationRuns` Indexes

**Status:** `by_case` and `by_prompt_version` on `calibrationRuns` support intended queries. `calibrationCases` has no custom index; lookups are by `_id` from `getCase`, which is sufficient.

---

#### `postRevisions.aiMetadata` Without `prompt`

**Status:** The pasted schema drops `prompt` from `aiMetadata`. The current `updatePost` flow only stores `operationType`, `provider`, and `model`. This is consistent. Any legacy `saveRefinement` (or equivalent) that wrote `prompt` would need to be removed or updated.

---

## Optional Refactored Versions

### Refactored `ai.ts` — Stricter Typing

```ts
"use node";

import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { api } from "./_generated/api";
import { callModel } from "./lib/aiClient";
import { EDITORIAL_MODES, EditorialMode } from "./lib/prompts";

type RefinementResult = {
  originalText: string;
  suggestedText: string;
  mode: EditorialMode;
  provider: string;
  model: string;
};

async function runRefinement(
  ctx: ActionCtx,
  args: { postId?: Id<"posts">; text?: string },
  mode: EditorialMode
): Promise<RefinementResult> {
  const userInfo = await ctx.runQuery(api.users.whoami);
  if (!userInfo) throw new Error("Unauthenticated");

  let sourceText: string;

  if (args.postId) {
    const post = await ctx.runQuery(api.posts.getPost, { postId: args.postId });
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
    temperature: modeConfig.modelConfig.temperature,
  });

  return {
    originalText: sourceText,
    suggestedText,
    mode,
    provider,
    model,
  };
}

const refineArgs = {
  postId: v.optional(v.id("posts")),
  text: v.optional(v.string()),
};

export const refineDevelopmental = action({
  args: refineArgs,
  handler: async (ctx, args) =>
    runRefinement(
      ctx,
      { postId: args.postId, text: args.text },
      "developmental"
    ),
});

export const refineLine = action({
  args: refineArgs,
  handler: async (ctx, args) =>
    runRefinement(ctx, { postId: args.postId, text: args.text }, "line"),
});

export const refineCopy = action({
  args: refineArgs,
  handler: async (ctx, args) =>
    runRefinement(ctx, { postId: args.postId, text: args.text }, "copy"),
});
```

---

### Refactored Calibration — Server-Side Gate

```ts
// At top of calibration.ts and calibrationActions.ts handlers:
function requireCalibrationEnabled() {
  if (process.env.ENABLE_CALIBRATION !== "true") {
    throw new Error(
      "Calibration harness is disabled. Set ENABLE_CALIBRATION=true in Convex env."
    );
  }
}

// In createCase handler:
export const createCase = mutation({
  args: { ... },
  handler: async (ctx, { name, inputText, mode, constraints }) => {
    requireCalibrationEnabled();
    const userId = await requireUser(ctx);
    // ...
  },
});
```

---

## Summary of Recommended Changes

**High Priority:**
1. Keep `lastEditedAt` optional in schema, or backfill existing posts.
2. Add server-side calibration gate in Convex (`ENABLE_CALIBRATION` in Convex env, checked in calibration mutations).
3. Fix `runRefinement` context typing (use `ActionCtx`).

**Medium Priority:**
4. Rename `runError` → `error` (or similar) for shared error state.
5. Apply color palette rules on calibration page (reduce purple to badges only).
6. Remove `args.postId as any` and use proper `Id<"posts">` typing.

**Low Priority:**
7. Add pagination to `listCases` and `listRunsForCase` if usage grows.
8. Document that `convex/lib/prompts.ts` is a required dependency for calibration.
9. Consider role-based access for calibration if it should be admin-only.

---

## Testing Recommendations

1. **Calibration disabled** — Set `NEXT_PUBLIC_ENABLE_CALIBRATION=false`; confirm nav link is hidden and page shows disabled message.
2. **Calibration enabled** — Create a case, run all three modes, verify checks and ratings.
3. **Check thresholds** — Use inputs that should trigger pass/warning/fail for each mode.
4. **promptVersionId** — Change a prompt, re-run a case, confirm different `promptVersion` values.
5. **API when disabled** — With UI disabled, attempt to call calibration mutations; confirm behavior with and without server-side gate.
6. **Existing posts** — After schema changes, confirm posts without `lastEditedAt` still load correctly.
