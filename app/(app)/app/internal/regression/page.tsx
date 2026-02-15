"use client";

import { useState } from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

export default function RegressionPage() {
  const isDev = process.env.NEXT_PUBLIC_VOICE_ENGINE_DEBUG === "true";
  const baseline = useQuery(api.voiceRegressionData.getBaseline);
  const recentRuns = useQuery(api.voiceRegressionData.getRecentRuns, {
    limit: 5,
  });
  const runRegression = useAction(api.voiceRegression.runRegressionAction);
  const saveBaseline = useAction(api.voiceRegression.saveBaselineFromRun);

  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<{
    passed: boolean;
    configHash: string;
    static: Record<string, number | Record<string, unknown>>;
    failures: Array<{ rule: string; baseline: number; current: number; threshold: string }>;
    baseline: { configHash: string; createdAt: number; static: unknown } | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    setLastResult(null);
    try {
      const result = await runRegression({ skipEmbeddings: true });
      setLastResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regression failed");
    } finally {
      setRunning(false);
    }
  };

  const handleSaveBaseline = async () => {
    if (!lastResult?.passed || !lastResult.static) return;
    setRunning(true);
    setError(null);
    try {
      const s = lastResult.static as Record<string, number>;
      await saveBaseline({
        static: {
          goodWinRate: s.goodWinRate,
          falseNegatives: s.falseNegatives,
          total: s.total,
          meanSemanticGood: s.meanSemanticGood,
          meanStylisticGood: s.meanStylisticGood,
          meanScopeGood: s.meanScopeGood,
          meanCombinedGood: s.meanCombinedGood,
          meanSemanticBad: s.meanSemanticBad,
          meanStylisticBad: s.meanStylisticBad,
          meanScopeBad: s.meanScopeBad,
          meanCombinedBad: s.meanCombinedBad,
          byMode: s.byMode,
        },
      });
      setLastResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setRunning(false);
    }
  };

  if (!isDev) {
    return (
      <div className="p-8 text-center text-sm text-gray-500">
        Regression suite is disabled. Set{" "}
        <code className="rounded bg-gray-100 px-1 py-0.5">
          NEXT_PUBLIC_VOICE_ENGINE_DEBUG=true
        </code>{" "}
        to enable.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Voice Regression Suite</h1>
        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          DEPLOY GATE
        </span>
      </div>

      <p className="text-sm text-gray-600">
        Run against the fixed calibration set. Fails if voice preservation,
        meaning preservation, or selection stability degrades beyond baseline.
        Use before deploying prompt, weight, or model changes.
      </p>

      {/* Baseline */}
      <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-semibold mb-2">Baseline</h2>
        {baseline ? (
          <div className="text-sm text-gray-600 space-y-1">
            <p>
              Config hash: <code className="text-xs">{baseline.configHash}</code>
            </p>
            <p>
              Created: {new Date(baseline.createdAt).toLocaleString()}
            </p>
            <p>
              goodWinRate: {baseline.static.goodWinRate.toFixed(4)} · falseNegatives:{" "}
              {baseline.static.falseNegatives}
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            No baseline. Run the script with <code>--save-baseline</code> first,
            or run regression and save from a passing result.
          </p>
        )}
      </div>

      {/* Run */}
      <div className="flex gap-3 items-center">
        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {running ? "Running…" : "Run Regression"}
        </button>
        {lastResult?.passed && lastResult.static && (
          <button
            type="button"
            onClick={handleSaveBaseline}
            disabled={running}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            Save as Baseline
          </button>
        )}
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Last result */}
      {lastResult && (
        <div
          className={`rounded-lg border p-4 ${
            lastResult.passed
              ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20"
              : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
          }`}
        >
          <h2 className="text-sm font-semibold mb-2">
            Result: {lastResult.passed ? "PASS" : "FAIL"}
          </h2>

          {lastResult.failures.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-medium text-gray-600 mb-1">
                Gating Failures
              </h3>
              <ul className="text-sm space-y-1">
                {lastResult.failures.map((f) => (
                  <li key={f.rule}>
                    {f.rule}: {f.threshold}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-gray-500">goodWinRate</span>{" "}
              {(lastResult.static as Record<string, number>).goodWinRate?.toFixed(4)}
            </div>
            <div>
              <span className="text-gray-500">falseNegatives</span>{" "}
              {(lastResult.static as Record<string, number>).falseNegatives}
            </div>
            <div>
              <span className="text-gray-500">meanStylisticGood</span>{" "}
              {(lastResult.static as Record<string, number>).meanStylisticGood?.toFixed(4)}
            </div>
            <div>
              <span className="text-gray-500">meanSemanticGood</span>{" "}
              {(lastResult.static as Record<string, number>).meanSemanticGood?.toFixed(4)}
            </div>
            <div>
              <span className="text-gray-500">meanCombinedGood</span>{" "}
              {(lastResult.static as Record<string, number>).meanCombinedGood?.toFixed(4)}
            </div>
          </div>

          {!lastResult.passed && (
            <p className="mt-4 text-sm font-medium text-red-800 dark:text-red-400">
              *** DO NOT DEPLOY ***
            </p>
          )}
        </div>
      )}

      {/* Recent runs */}
      {recentRuns && recentRuns.length > 0 && (
        <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <h2 className="text-sm font-semibold mb-2">Recent Runs</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1">Time</th>
                <th className="py-1">Result</th>
                <th className="py-1">goodWinRate</th>
                <th className="py-1">Failures</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((run) => (
                <tr key={run._id} className="border-t border-gray-100">
                  <td className="py-1">
                    {new Date(run.createdAt).toLocaleString()}
                  </td>
                  <td className="py-1">
                    <span
                      className={
                        run.passed
                          ? "text-green-600 font-medium"
                          : "text-red-600 font-medium"
                      }
                    >
                      {run.passed ? "PASS" : "FAIL"}
                    </span>
                  </td>
                  <td className="py-1 tabular-nums">
                    {run.static.goodWinRate.toFixed(4)}
                  </td>
                  <td className="py-1 text-xs">
                    {run.failures.length > 0
                      ? run.failures.map((f) => f.rule).join(", ")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Script usage */}
      <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-semibold mb-2">CLI Usage</h2>
        <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto dark:bg-gray-900">
{`# Run regression (gates against baseline)
npx tsx scripts/voice-calibration/run-regression.ts

# Save current metrics as baseline (after verifying)
npx tsx scripts/voice-calibration/run-regression.ts --save-baseline

# With embeddings (requires OPENAI_API_KEY)
npx tsx scripts/voice-calibration/run-regression.ts
# Or: SKIP_EMBEDDINGS=true for heuristic-only (default)

# In CI: fail the build on regression
npx tsx scripts/voice-calibration/run-regression.ts || exit 1`}
        </pre>
      </div>
    </div>
  );
}
