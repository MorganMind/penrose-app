/**
 * B3.7 — Stability & Edge Case Hardening
 *
 * Central stability primitives for the realtime suggestion system.
 * Enforces:
 *   - Max suggestion frequency (sliding-window rate limiter)
 *   - Circuit breaker for repeated network failures
 *   - Document version tracking for stale-request detection
 *   - Rapid typing detection (burst guard)
 *   - Internal metrics logging (trigger timing, cancellation, acceptance)
 *
 * Design principles:
 *   - Canvas ALWAYS wins over AI. Any user edit invalidates suggestions.
 *   - No user-facing alerts. All errors resolve silently.
 *   - All metrics are console.debug — internal only.
 */

// ── Rate Limiter ──────────────────────────────────────────────────────────────

const DEFAULT_MAX_PER_MINUTE = 8;
const DEFAULT_WINDOW_MS = 60_000;

export class SuggestionRateLimiter {
  private timestamps: number[] = [];
  private readonly maxPerWindow: number;
  private readonly windowMs: number;

  constructor(
    maxPerWindow = DEFAULT_MAX_PER_MINUTE,
    windowMs = DEFAULT_WINDOW_MS
  ) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
  }

  /** Returns true if another suggestion can be triggered. */
  canTrigger(): boolean {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    return this.timestamps.length < this.maxPerWindow;
  }

  /** Record that a suggestion was triggered (call after dispatching). */
  record(): void {
    this.timestamps.push(Date.now());
  }

  reset(): void {
    this.timestamps = [];
  }
}

// ── Circuit Breaker ───────────────────────────────────────────────────────────

const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_RESET_MS = 30_000;

export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openUntil: number | null = null;

  /** True when the breaker is tripped — callers should NOT attempt requests. */
  isOpen(): boolean {
    if (this.openUntil === null) return false;
    if (Date.now() >= this.openUntil) {
      // Half-open: reset and allow one attempt
      this.openUntil = null;
      this.consecutiveFailures = 0;
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openUntil = null;
  }

  recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      this.openUntil = Date.now() + CIRCUIT_RESET_MS;
    }
  }

  reset(): void {
    this.consecutiveFailures = 0;
    this.openUntil = null;
  }
}

// ── Document Version Tracker ──────────────────────────────────────────────────

export class DocVersionTracker {
  private version = 0;

  /** Increment and return the new version. Call on every doc change. */
  increment(): number {
    return ++this.version;
  }

  /** Return the current version. */
  current(): number {
    return this.version;
  }
}

// ── Rapid Typing Detector ─────────────────────────────────────────────────────

export class RapidTypingDetector {
  private timestamps: number[] = [];
  private readonly threshold: number;
  private readonly windowMs: number;

  /**
   * @param threshold Number of keystrokes within the window to count as "rapid"
   * @param windowMs Sliding window size in ms
   */
  constructor(threshold = 3, windowMs = 1000) {
    this.threshold = threshold;
    this.windowMs = windowMs;
  }

  /** Record a keystroke (doc change). */
  record(): void {
    this.timestamps.push(Date.now());
  }

  /** True if the user is typing rapidly (canvas should win, suppress triggers). */
  isRapidTyping(): boolean {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    return this.timestamps.length >= this.threshold;
  }

  reset(): void {
    this.timestamps = [];
  }
}

// ── Internal Metrics Logger ───────────────────────────────────────────────────

const LOG_PREFIX = "[penrose:suggestions]";
const SUMMARY_INTERVAL_MS = 60_000;

interface MetricsSnapshot {
  triggerCount: number;
  cancelCount: number;
  acceptCount: number;
  rejectCount: number;
  errorCount: number;
  rateLimitCount: number;
  circuitBreakerCount: number;
  staleCount: number;
  latencySamples: number[];
}

export class SuggestionMetricsLogger {
  private metrics: MetricsSnapshot;
  private summaryTimer: ReturnType<typeof setInterval> | null = null;
  private readonly mode: string;

  constructor(mode: string) {
    this.mode = mode;
    this.metrics = this.emptySnapshot();
  }

  private emptySnapshot(): MetricsSnapshot {
    return {
      triggerCount: 0,
      cancelCount: 0,
      acceptCount: 0,
      rejectCount: 0,
      errorCount: 0,
      rateLimitCount: 0,
      circuitBreakerCount: 0,
      staleCount: 0,
      latencySamples: [],
    };
  }

  /** Begin periodic summary logging. Idempotent. */
  start(): void {
    if (this.summaryTimer) return;
    this.summaryTimer = setInterval(
      () => this.logSummary(),
      SUMMARY_INTERVAL_MS
    );
  }

  /** Stop periodic logging. */
  stop(): void {
    if (this.summaryTimer) {
      clearInterval(this.summaryTimer);
      this.summaryTimer = null;
    }
  }

  // ── Recording methods ────────────────────────────────────────────────

  recordTrigger(): void {
    this.metrics.triggerCount++;
  }
  recordCancel(): void {
    this.metrics.cancelCount++;
  }
  recordAccept(): void {
    this.metrics.acceptCount++;
  }
  recordReject(): void {
    this.metrics.rejectCount++;
  }
  recordError(): void {
    this.metrics.errorCount++;
  }
  recordRateLimit(): void {
    this.metrics.rateLimitCount++;
  }
  recordCircuitBreaker(): void {
    this.metrics.circuitBreakerCount++;
  }
  recordStale(): void {
    this.metrics.staleCount++;
  }

  recordLatency(ms: number): void {
    this.metrics.latencySamples.push(ms);
    // Keep a rolling window of the last 50 samples
    if (this.metrics.latencySamples.length > 50) {
      this.metrics.latencySamples = this.metrics.latencySamples.slice(-50);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────

  private logSummary(): void {
    const m = this.metrics;
    if (
      m.triggerCount === 0 &&
      m.cancelCount === 0 &&
      m.acceptCount === 0
    ) {
      return; // Nothing to report
    }

    const acceptRate =
      m.triggerCount > 0
        ? ((m.acceptCount / m.triggerCount) * 100).toFixed(1)
        : "0.0";
    const cancelRate =
      m.triggerCount > 0
        ? ((m.cancelCount / m.triggerCount) * 100).toFixed(1)
        : "0.0";
    const avgLatency =
      m.latencySamples.length > 0
        ? (
            m.latencySamples.reduce((a, b) => a + b, 0) /
            m.latencySamples.length
          ).toFixed(0)
        : "n/a";

    console.debug(
      `${LOG_PREFIX} [${this.mode}] ` +
        `triggers=${m.triggerCount} accepts=${m.acceptCount}(${acceptRate}%) ` +
        `cancels=${m.cancelCount}(${cancelRate}%) errors=${m.errorCount} ` +
        `rateLimited=${m.rateLimitCount} circuitBreaker=${m.circuitBreakerCount} ` +
        `stale=${m.staleCount} avgLatency=${avgLatency}ms`
    );

    // Reset for next window
    this.metrics = this.emptySnapshot();
  }

  /** Flush final summary and stop timer. */
  destroy(): void {
    this.logSummary();
    this.stop();
  }
}

// ── Selection Guard ───────────────────────────────────────────────────────────

/**
 * Returns true if the selection is a single, collapsed cursor (primary only).
 * Returns false for range selections, node selections, multi-range, etc.
 * Suggestions should ONLY trigger when this returns true.
 */
export function isSingleCursorSelection(selection: {
  empty: boolean;
  ranges?: readonly { $from: { pos: number }; $to: { pos: number } }[];
}): boolean {
  if (!selection.empty) return false;
  // Multi-range guard (non-standard but defensive)
  if (selection.ranges && selection.ranges.length > 1) return false;
  return true;
}
