const DEFAULT_FLUSH_INTERVAL = 1000;

/**
 * Counts filtered-out events by reason code and periodically emits aggregate
 * drop metrics. The clock is injected so tests can advance time without
 * sleeping; this is the only way to keep the suite deterministic.
 */
export class DroppedSampleCounter {
  /**
   * @param {object} [options]
   * @param {number} [options.flushInterval=1000] Number of accepted samples
   *   between automatic flushes. Must be a positive integer. A value of 0 or
   *   Infinity disables automatic flushing.
   * @param {(metrics: {total: number, byReason: Record<string, number>}) => void} [options.onFlush]
   *   Called with an aggregate snapshot whenever a flush happens.
   * @param {() => number} [options.now=Date.now] Clock function returning
   *   milliseconds. Injected for determinism.
   */
  constructor(options = {}) {
    const {
      flushInterval = DEFAULT_FLUSH_INTERVAL,
      onFlush = null,
      now = Date.now,
    } = options;

    if (flushInterval !== Infinity && (!Number.isInteger(flushInterval) || flushInterval < 0)) {
      throw new TypeError('flushInterval must be a non-negative integer or Infinity');
    }
    if (onFlush !== null && typeof onFlush !== 'function') {
      throw new TypeError('onFlush must be a function or null');
    }
    if (typeof now !== 'function') {
      throw new TypeError('now must be a function');
    }

    this.flushInterval = flushInterval;
    this.onFlush = onFlush;
    this.now = now;

    /** @type {Map<string, number>} */
    this.counts = new Map();
    this.total = 0;
    this.sinceFlush = 0;
    this.lastFlushAt = this.now();
  }

  /**
   * Record one dropped sample under the given reason code.
   * @param {string} reason
   * @returns {number} The new count for this reason.
   */
  drop(reason) {
    if (typeof reason !== 'string' || reason.length === 0) {
      throw new TypeError('reason must be a non-empty string');
    }

    const next = (this.counts.get(reason) ?? 0) + 1;
    this.counts.set(reason, next);
    this.total += 1;
    this.sinceFlush += 1;

    if (this.flushInterval !== Infinity && this.flushInterval > 0 && this.sinceFlush >= this.flushInterval) {
      this.flush();
    }

    return next;
  }

  /**
   * Record several drops at once. Useful when a batch filter rejects a run of
   * samples for the same reason.
   * @param {string} reason
   * @param {number} [count=1]
   * @returns {number} The new count for this reason.
   */
  dropMany(reason, count = 1) {
    if (typeof reason !== 'string' || reason.length === 0) {
      throw new TypeError('reason must be a non-empty string');
    }
    if (!Number.isInteger(count) || count < 0) {
      throw new TypeError('count must be a non-negative integer');
    }
    if (count === 0) {
      return this.counts.get(reason) ?? 0;
    }

    const next = (this.counts.get(reason) ?? 0) + count;
    this.counts.set(reason, next);
    this.total += count;
    this.sinceFlush += count;

    if (this.flushInterval !== Infinity && this.flushInterval > 0 && this.sinceFlush >= this.flushInterval) {
      this.flush();
    }

    return next;
  }

  /**
   * Produce a plain snapshot of current counters. The returned object is a
   * fresh copy, so callers cannot mutate internal state.
   * @returns {{total: number, byReason: Record<string, number>}}
   */
  snapshot() {
    return {
      total: this.total,
      byReason: Object.fromEntries(this.counts),
    };
  }

  /**
   * Emit the current aggregate and reset the since-flush counter. If no drops
   * have occurred since the last flush, this is a no-op and returns null so
   * callers do not emit empty metrics.
   * @returns {{total: number, byReason: Record<string, number>} | null}
   */
  flush() {
    if (this.total === 0) {
      return null;
    }

    const metrics = this.snapshot();
    this.sinceFlush = 0;
    this.lastFlushAt = this.now();

    if (this.onFlush) {
      this.onFlush(metrics);
    }

    return metrics;
  }

  /**
   * Reset all counters and the since-flush counter. Does not call onFlush.
   */
  reset() {
    this.counts.clear();
    this.total = 0;
    this.sinceFlush = 0;
    this.lastFlushAt = this.now();
  }
}
