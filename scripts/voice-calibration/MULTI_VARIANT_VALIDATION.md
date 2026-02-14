# Multi-Variant Validation

## Purpose

Proves that multi-variant selection improves consistency vs single-pass by comparing:

- **Average voice similarity** (stylistic score) — multi-variant should match author voice better
- **Variance between reruns** — multi-variant should be more stable (lower variance)
- **Enforcement trigger frequency** — multi-variant should trigger drift/soft_warning/failure less often

## Running

```bash
# Option 1: Ensure OPENAI_API_KEY is in .env.local (loaded automatically)
npm run validate:multi-variant

# Option 2: Pass key explicitly
OPENAI_API_KEY=sk-... npm run validate:multi-variant
```

Uses 12 examples × 3 reruns = 36 single-pass calls + 72 multi-variant calls (~108 API calls total).

## Expected Outcome

Multi-variant should show:

1. ✓ Equal or higher average stylistic score
2. ✓ Lower variance across reruns (more consistent)
3. ✓ Fewer enforcement triggers
4. ✓ Fewer drift incidents

If multi-variant does **not** materially improve stability:

- Reduce candidate count (e.g., 2 → 1 if 2 doesn't help)
- Adjust selection weights in `convex/lib/candidateSelection.ts`
- Do **not** add more candidates blindly

## Per-Candidate Storage

Every run stores full metadata for analysis:

**editorialRuns:** `enforcementClass`, `enforcementOutcome`, `retryAttempted`, `returnedOriginal`, `initialBestCombinedScore`, `finalBestCombinedScore`, `selectedCandidateIndex`, `bestPassingIndex`

**editorialCandidates:** `semanticScore`, `stylisticScore`, `scopeScore`, `combinedScore`, `selectionScore`, `passed`, `selected`, `shown`, `variationKey`, `generationPhase`, `enforcementClass`

**Query:** `voiceAnalytics.getRunWithCandidates(runId)` returns run + all candidates with full scores and winner selection metadata for future analysis.
