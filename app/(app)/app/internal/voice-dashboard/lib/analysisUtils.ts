/**
 * Pure computation utilities for the voice dashboard.
 * No Convex or React dependencies.
 */

export function formatScore(value: number): string {
  return value.toFixed(3);
}

export type SimulationThresholds = {
  semantic: number;
  stylistic: number;
  scope: number;
  combined: number;
};

export type ScoreTuple = {
  id: string;
  semantic: number;
  stylistic: number;
  scope: number;
  combined: number;
  passed: boolean;
  enforced: boolean;
  thresholds: SimulationThresholds;
  originalPreview?: string;
};

export type SimulationResult = {
  totalEnforced: number;
  currentPassed: number;
  currentFailed: number;
  simulatedPassed: number;
  simulatedFailed: number;
  netChange: number;
  flips: Array<{
    id: string;
    direction: "pass_to_fail" | "fail_to_pass";
    mode: string;
    scores: { semantic: number; stylistic: number; scope: number; combined: number };
    failedDimensions: string[];
    originalPreview?: string;
  }>;
};

export function simulateThresholds(
  scores: ScoreTuple[],
  proposed: SimulationThresholds,
  mode: string = "line"
): SimulationResult {
  const enforced = scores.filter((s) => s.enforced);

  const currentPassed = enforced.filter((s) => s.passed).length;
  const currentFailed = enforced.length - currentPassed;

  const flips: SimulationResult["flips"] = [];
  let simulatedPassed = 0;

  for (const s of enforced) {
    const wouldPass =
      s.semantic >= proposed.semantic &&
      s.stylistic >= proposed.stylistic &&
      s.scope >= proposed.scope &&
      s.combined >= proposed.combined;

    if (wouldPass) simulatedPassed++;

    if (wouldPass !== s.passed) {
      const failedDimensions: string[] = [];
      if (!wouldPass) {
        if (s.semantic < proposed.semantic) failedDimensions.push("semantic");
        if (s.stylistic < proposed.stylistic)
          failedDimensions.push("stylistic");
        if (s.scope < proposed.scope) failedDimensions.push("scope");
        if (s.combined < proposed.combined) failedDimensions.push("combined");
      }

      flips.push({
        id: s.id,
        direction: s.passed ? "pass_to_fail" : "fail_to_pass",
        mode,
        scores: {
          semantic: s.semantic,
          stylistic: s.stylistic,
          scope: s.scope,
          combined: s.combined,
        },
        failedDimensions,
        originalPreview: s.originalPreview,
      });
    }
  }

  const simulatedFailed = enforced.length - simulatedPassed;

  return {
    totalEnforced: enforced.length,
    currentPassed,
    currentFailed,
    simulatedPassed,
    simulatedFailed,
    netChange: simulatedPassed - currentPassed,
    flips: flips.sort((a, b) => 0),
  };
}
