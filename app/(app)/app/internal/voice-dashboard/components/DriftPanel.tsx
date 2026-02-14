"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export function DriftPanel() {
  const alerts = useQuery(api.voiceRunMetrics.listUnacknowledgedDriftAlerts, {
    limit: 50,
  });

  if (!alerts) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-zinc-400">
        Loading drift alerts…
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
        No unacknowledged drift alerts. Cross-run metrics are monitored
        automatically; alerts are created when similarity drops or
        variance spikes are detected.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        System protection: drift detected across runs. Model and prompt
        version stored with every run for regression tracing.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-zinc-500 dark:border-zinc-700">
              <th className="py-2 pr-3 font-medium">Time</th>
              <th className="py-2 pr-3 font-medium">User</th>
              <th className="py-2 pr-3 font-medium">Model</th>
              <th className="py-2 pr-3 font-medium">Prompt</th>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium">Severity</th>
              <th className="py-2 pr-3 font-medium">Avg before</th>
              <th className="py-2 pr-3 font-medium">Avg after</th>
              <th className="py-2 font-medium">Runs</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr
                key={a._id}
                className="border-b border-zinc-100 dark:border-zinc-800"
              >
                <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                  {new Date(a.createdAt).toLocaleString()}
                </td>
                <td className="py-2 pr-3 font-mono text-zinc-500">
                  {a.userId.slice(-6)}
                </td>
                <td className="py-2 pr-3">{a.model}</td>
                <td className="py-2 pr-3 font-mono text-zinc-500">
                  {a.promptVersion.slice(0, 12)}…
                </td>
                <td className="py-2 pr-3 capitalize">
                  {a.alertType.replace(/_/g, " ")}
                </td>
                <td className="py-2 pr-3">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                      a.severity === "high"
                        ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                        : a.severity === "medium"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                    }`}
                  >
                    {a.severity}
                  </span>
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {a.rollingAvgBefore?.toFixed(3) ?? "—"}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {a.rollingAvgAfter?.toFixed(3) ?? "—"}
                </td>
                <td className="py-2 tabular-nums">{a.runCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
