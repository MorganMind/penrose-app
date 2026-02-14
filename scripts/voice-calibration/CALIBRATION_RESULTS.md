# Voice Scoring Calibration Results

**Date:** 2025-02-13  
**Dataset:** 41 examples (messy drafts, polished, emotional, technical, short, long)  
**Mode:** Heuristic-only semantic (SKIP_EMBEDDINGS=true)

## Summary

| Metric | Value |
|--------|-------|
| Total examples | 41 |
| Good edits outscore bad | 40/41 (97.6%) |
| False negatives | 1 |
| Stylistic: good > bad | 41/41 (100%) |
| Semantic: good > bad | 16/41 (heuristic-only) |
| Scope: good > bad | 24/41 |

## Single Failure

**messy-1** [messy_draft/line]
- Good: sem=0.765, sty=0.469, scope=0.859, combined=0.655
- Bad:  sem=0.765, sty=0.458, scope=0.890, combined=0.658
- Cause: Bad edit had higher scope (word/paragraph ratio closer to original) which outweighed the stylistic advantage of the good edit.

## Weight Tuning (Data-Driven)

Grid search over semantic/stylistic/scope weights found **100% accuracy** with:

| Mode | Semantic | Stylistic | Scope |
|------|----------|-----------|-------|
| line | 0.20 | 0.65 | 0.15 |
| developmental | 0.20 | 0.65 | 0.15 |

**Rationale:** Stylistic score discriminates perfectly (good > bad in 100% of cases). Increasing stylistic weight from 0.45 to 0.65 fixes the messy-1 edge case where scope favored the bad edit.

## By Category

| Category | Good Wins | Total | Rate |
|----------|-----------|-------|------|
| messy_draft | 6 | 7 | 86% |
| polished | 7 | 7 | 100% |
| emotional | 7 | 7 | 100% |
| technical | 7 | 7 | 100% |
| short | 6 | 6 | 100% |
| long | 7 | 7 | 100% |

## Running with Full Embeddings

For semantic scores using OpenAI embeddings (more accurate):

```bash
# Ensure OPENAI_API_KEY is in .env.local
npx tsx scripts/voice-calibration/run-calibration.ts
```

For quick runs without API calls:

```bash
SKIP_EMBEDDINGS=true npx tsx scripts/voice-calibration/run-calibration.ts
```
