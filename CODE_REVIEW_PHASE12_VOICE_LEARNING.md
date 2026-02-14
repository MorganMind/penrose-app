# Code Review: Phase 12 — User-Facing Voice Learning Loop

## Rule applicability

**Rule 1: schema-migrations** — Unsatisfied. Schema adds `voiceReactions`, `voiceNudges`, `voicePreferences`, `calibrationCases`, `calibrationRuns` and changes `lastEditedAt` from optional to required. No migration strategy or backfill for existing posts without `lastEditedAt`.

**Rule 2: env-and-secrets** — Unsatisfied. `OPENAI_API_KEY`, `AI_PROVIDER`, `AI_MODEL` are used with no `env.example` or documentation.

**Rule 3: convex-actions** — Satisfied. `ai.ts` and `voiceActions.ts` use `"use node"` for Node environment.

**Rule 4: error-handling** — Satisfied. Convex functions throw clear errors with descriptive messages.

**Rule 5: auth-required** — Satisfied. Mutations and actions use `requireOrgMember` or `whoami` for auth.

**Rule 6: tenant-isolation** — Satisfied. Queries use `orgId` and appropriate indexes (`by_org`, `by_org_and_user`, `by_org_and_mode`).

**Rule 7: rate-limiting** — Unsatisfied. No rate limiting on AI actions, reactions, or nudges.

**Rule 8: ids** — Satisfied. Convex `Id<>` types used for references.

**Rule 9: validated** — Satisfied. Convex args use `v.id()`, `v.string()`, `v.union()`, etc.

**Rule 10: i18n** — Unsatisfied. User-facing strings are hardcoded in English.

**Rule 11: logging** — Unsatisfied. No logging for AI calls, reactions, or validation.

**Rule 12: loading** — Satisfied. `refiningMode`, `isNudging`, `nudgingDirection` with disabled states during async work.

**Rule 13: error-ui** — Satisfied. `setError` and red error banner surface failures.

**Rule 14: mobile** — Unclear. Layout uses flex/grid but no explicit mobile breakpoints.

**Rule 15: accessibility** — Unclear. Buttons lack `aria-label`; focus/keyboard behavior not verified.

**Rule 16: color** — Unsatisfied. Primary buttons use purple (`bg-purple-600`, `bg-purple-50`, `text-purple-700`). Color palette rule restricts buttons to gray scale.

**Rule 17: performance** — Unclear. `getReactionCount` runs per `ReactionPanel`; no memoization strategy.

**Rule 18: security** — Unclear. Scratchpad content injected into prompts; no explicit delimiter or injection protection.

**Rule 19: testing** — Unsatisfied. No unit or integration tests.

**Rule 20: docs** — Unsatisfied. No README or env docs for Phase 12; “How the voice learning loop works” is not in the repo.

**Rule 21: analytics** — Unsatisfied. No analytics for reactions, nudges, or usage.

**Rule 22: schema-docs** — Unsatisfied. New tables lack JSDoc or description.

**Rule 23: prompts** — Unclear. Scratchpad content appended to prompts; no explicit prompt-injection safeguards.

**Rule 24: feature-flags** — Unsatisfied. No feature flag for voice learning; behavior cannot be disabled.

**Rule 25: types** — Unsatisfied. `ai.ts` uses `postId: args.postId as any` in `runRefinement` (also present in current repo).

**Rule 26: convex** — Unclear. Convex patterns used; no check for `aiClient` extraction or `promptVersionId` implementation.

**Rule 27: react** — Satisfied. Hooks declared before early returns; no conditional hooks.

**Rule 28: next** — Unclear. Next.js usage not fully verified.

**Rule 29: typescript** — Unclear. Strict mode not verified.

**Rule 30: naming** — Satisfied. Names are clear (`NudgeBar`, `ReactionPanel`, `VoiceScratchpad`, etc.).

**Rule 31: git** — Satisfied. No generated files committed.

**Rule 32: scripts** — Satisfied. No new scripts required.

**Rule 33: dependencies** — Unclear. `aiClient` is imported but not provided in the implementation; extraction from `ai.ts` is implied.

**Rule 34: config** — Satisfied. No new config files.

**Rule 35: rbac** — Satisfied. No new roles; `requireOrgMember` used.

**Rule 36: infra** — Satisfied. No infra changes.

**Rule 37: monitoring** — Unsatisfied. No monitoring for AI usage or failures.

**Rule 38: audit** — Unclear. Reactions and nudges are persisted; uncertain if treated as formal audit trail.

**Rule 39: data** — Unsatisfied. No retention policy for `voiceReactions`, `voiceNudges`, `voicePreferences`.

**Rule 40: compliance** — Satisfied. No compliance requirements identified.

**Rule 41: cost** — Unsatisfied. No cost controls or rate limiting on AI calls.

**Rule 42: observability** — Unsatisfied. No tracing or observability for AI or reaction flows.
