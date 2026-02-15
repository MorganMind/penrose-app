/**
 * Lightweight in-memory metrics for the realtime suggestion system.
 *
 * Tracks: trigger timing, cancellation frequency, acceptance rate,
 * cache hit rate, throttle skips, stale discards, and network errors.
 *
 * Never surfaces to the UI. Available in dev console via
 * `window.__suggestionMetrics.getSummary()`.
 */

export type MetricType =
  | "trigger"
  | "cancel"
  | "accept"
  | "reject"
  | "cache_hit"
  | "network_error"
  | "throttle_skip"
  | "stale_discard"
  | "prefetch_start"
  | "prefetch_hit"
  | "rapid_typing_skip"
  | "selection_skip"
  | "conflict_skip";

export type SuggestionMode = "ghost" | "replacement";

interface MetricEntry {
  timestamp: number;
  type: MetricType;
  mode: SuggestionMode;
  latencyMs?: number;
  detail?: string;
}

class SuggestionMetricsCollector {
  private entries: MetricEntry[] = [];
  private readonly MAX_ENTRIES = 1000;

  record(
    type: MetricType,
    mode: SuggestionMode,
    extra?: { latencyMs?: number; detail?: string }
  ) {
    this.entries.push({
      timestamp: Date.now(),
      type,
      mode,
      ...extra,
    });
    if (this.entries.length > this.MAX_ENTRIES) {
      this.entries = this.entries.slice(-this.MAX_ENTRIES);
    }
  }

  /**
   * Returns a summary of metrics within the given time window.
   * Default: last 60 seconds.
   */
  getSummary(windowMs: number = 60_000) {
    const cutoff = Date.now() - windowMs;
    const recent = this.entries.filter((e) => e.timestamp >= cutoff);

    const count = (type: MetricType, mode?: SuggestionMode) =>
      recent.filter((e) => e.type === type && (!mode || e.mode === mode))
        .length;

    const avgLatency = (mode: SuggestionMode) => {
      const triggers = recent.filter(
        (e) => e.type === "trigger" && e.mode === mode && e.latencyMs != null
      );
      if (triggers.length === 0) return 0;
      return Math.round(
        triggers.reduce((sum, e) => sum + (e.latencyMs ?? 0), 0) /
          triggers.length
      );
    };

    const modeSummary = (mode: SuggestionMode) => ({
      triggers: count("trigger", mode),
      cancels: count("cancel", mode),
      accepts: count("accept", mode),
      rejects: count("reject", mode),
      cacheHits: count("cache_hit", mode),
      prefetchStarts: count("prefetch_start", mode),
      prefetchHits: count("prefetch_hit", mode),
      networkErrors: count("network_error", mode),
      throttleSkips: count("throttle_skip", mode),
      staleDiscards: count("stale_discard", mode),
      rapidTypingSkips: count("rapid_typing_skip", mode),
      selectionSkips: count("selection_skip", mode),
      conflictSkips: count("conflict_skip", mode),
      avgLatencyMs: avgLatency(mode),
    });

    return {
      ghost: modeSummary("ghost"),
      replacement: modeSummary("replacement"),
      totalEntries: recent.length,
      windowMs,
    };
  }

  /** Raw entries for debugging */
  getEntries() {
    return [...this.entries];
  }

  clear() {
    this.entries = [];
  }
}

/** Singleton metrics instance shared across all editor extensions */
export const suggestionMetrics = new SuggestionMetricsCollector();

// Expose on window for dev console debugging
if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__suggestionMetrics = suggestionMetrics;
}
