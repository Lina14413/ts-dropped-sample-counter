# ts-dropped-sample-counter

Counts filtered-out events by reason code and periodically emits aggregate drop metrics.

```js
import { DroppedSampleCounter } from 'ts-dropped-sample-counter';

const counter = new DroppedSampleCounter({
  flushInterval: 100,
  onFlush: (metrics) => {
    console.log(`dropped ${metrics.total}`, metrics.byReason);
  },
});

counter.drop('too-short');
counter.dropMany('too-noisy', 4);
counter.flush(); // { total: 5, byReason: { 'too-short': 1, 'too-noisy': 4 } }
```

## Why this exists

Filtering pipelines often discard samples for several distinct reasons, and it is easy to lose track of which reason dominates. This counter keeps a per-reason tally and emits a snapshot on a configurable cadence so a metrics sink can receive aggregates instead of one event per drop. The trade-off is that counts are only flushed when the interval is reached or when `flush()` is called explicitly; a process that crashes before a flush will lose the drops since the last flush. That is the deliberate choice: bounded metric traffic over perfect durability.

## API

### `new DroppedSampleCounter(options?)`

- `options.flushInterval` — number of accepted drops between automatic flushes. Defaults to `1000`. Use `0` or `Infinity` to disable automatic flushing.
- `options.onFlush` — callback receiving `{ total, byReason }` on every flush. Optional.
- `options.now` — clock function returning milliseconds. Defaults to `Date.now`. Inject a fake clock in tests to avoid wall-clock dependence.

### `drop(reason)`

Records one drop under `reason` and returns the new count for that reason. Throws `TypeError` if `reason` is not a non-empty string.

### `dropMany(reason, count = 1)`

Records `count` drops under `reason` and returns the new count. `count` must be a non-negative integer; `0` is a no-op.

### `snapshot()`

Returns a fresh `{ total, byReason }` object. Mutating the result does not affect the counter.

### `flush()`

Returns the current aggregate and resets the since-flush counter, or `null` if nothing has been dropped. Calls `onFlush` with the aggregate when a flush actually happens.

### `reset()`

Clears all counters and the since-flush counter. Does not call `onFlush`.

## Edge cases

- `flush()` on an empty counter returns `null` rather than emitting a zero-valued metric, so downstream aggregators do not receive empty pings.
- Automatic flushing uses `>=` against the interval, so a single `dropMany` larger than the interval triggers exactly one flush for the whole batch.
- `flushInterval: 0` and `flushInterval: Infinity` both disable automatic flushing; they are distinct only in intent.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

