import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DroppedSampleCounter } from '../src/index.js';

/**
 * Build a counter with a controllable clock. The clock is advanced manually so
 * no test ever depends on wall-clock time.
 */
function makeCounter(options = {}) {
  let t = 0;
  const clock = () => t;
  const counter = new DroppedSampleCounter({ ...options, now: clock });
  return { counter, advance: (ms) => { t += ms; }, getTime: () => t };
}

test('starts empty', () => {
  const { counter } = makeCounter();
  assert.deepEqual(counter.snapshot(), { total: 0, byReason: {} });
});

test('drop increments the reason count and total', () => {
  const { counter } = makeCounter();
  assert.equal(counter.drop('too-short'), 1);
  assert.equal(counter.drop('too-short'), 2);
  assert.equal(counter.drop('too-noisy'), 1);
  assert.deepEqual(counter.snapshot(), {
    total: 3,
    byReason: { 'too-short': 2, 'too-noisy': 1 },
  });
});

test('dropMany adds a batch atomically', () => {
  const { counter } = makeCounter();
  assert.equal(counter.dropMany('too-short', 5), 5);
  assert.equal(counter.dropMany('too-short', 2), 7);
  assert.deepEqual(counter.snapshot(), {
    total: 7,
    byReason: { 'too-short': 7 },
  });
});

test('dropMany with count 0 is a no-op', () => {
  const { counter } = makeCounter();
  counter.drop('a');
  assert.equal(counter.dropMany('a', 0), 1);
  assert.equal(counter.dropMany('b', 0), 0);
  assert.deepEqual(counter.snapshot(), {
    total: 1,
    byReason: { a: 1 },
  });
});

test('rejects empty reason codes', () => {
  const { counter } = makeCounter();
  assert.throws(() => counter.drop(''), TypeError);
  assert.throws(() => counter.dropMany('', 1), TypeError);
});

test('rejects non-string reason codes', () => {
  const { counter } = makeCounter();
  assert.throws(() => counter.drop(42), TypeError);
  assert.throws(() => counter.dropMany(null, 1), TypeError);
});

test('rejects negative or non-integer batch counts', () => {
  const { counter } = makeCounter();
  assert.throws(() => counter.dropMany('a', -1), TypeError);
  assert.throws(() => counter.dropMany('a', 1.5), TypeError);
});

test('flush returns null when nothing has been dropped', () => {
  const { counter } = makeCounter();
  assert.equal(counter.flush(), null);
});

test('flush returns a snapshot and resets the since-flush counter', () => {
  const { counter } = makeCounter();
  counter.drop('a');
  counter.drop('b');
  const metrics = counter.flush();
  assert.deepEqual(metrics, { total: 2, byReason: { a: 1, b: 1 } });
  assert.equal(counter.sinceFlush, 0);
});

test('flush invokes onFlush with the aggregate', () => {
  const seen = [];
  const { counter } = makeCounter({ onFlush: (m) => seen.push(m) });
  counter.drop('a');
  counter.flush();
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], { total: 1, byReason: { a: 1 } });
});

test('automatic flush fires at the interval boundary', () => {
  const seen = [];
  const { counter } = makeCounter({ flushInterval: 3, onFlush: (m) => seen.push(m) });
  counter.drop('a');
  counter.drop('a');
  assert.equal(seen.length, 0);
  counter.drop('a');
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], { total: 3, byReason: { a: 3 } });
});

test('automatic flush can fire from a single large batch', () => {
  const seen = [];
  const { counter } = makeCounter({ flushInterval: 2, onFlush: (m) => seen.push(m) });
  counter.dropMany('a', 5);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], { total: 5, byReason: { a: 5 } });
  assert.equal(counter.sinceFlush, 0);
});

test('flushInterval 0 disables automatic flushing', () => {
  const seen = [];
  const { counter } = makeCounter({ flushInterval: 0, onFlush: (m) => seen.push(m) });
  for (let i = 0; i < 100; i += 1) counter.drop('a');
  assert.equal(seen.length, 0);
  counter.flush();
  assert.equal(seen.length, 1);
});

test('flushInterval Infinity disables automatic flushing', () => {
  const seen = [];
  const { counter } = makeCounter({ flushInterval: Infinity, onFlush: (m) => seen.push(m) });
  for (let i = 0; i < 100; i += 1) counter.drop('a');
  assert.equal(seen.length, 0);
});

test('flush records the time from the injected clock', () => {
  const { counter, advance, getTime } = makeCounter();
  assert.equal(counter.lastFlushAt, 0);
  advance(250);
  counter.drop('a');
  counter.flush();
  assert.equal(counter.lastFlushAt, 250);
  assert.equal(getTime(), 250);
});

test('reset clears counters and the since-flush counter', () => {
  const { counter } = makeCounter();
  counter.drop('a');
  counter.drop('b');
  counter.reset();
  assert.deepEqual(counter.snapshot(), { total: 0, byReason: {} });
  assert.equal(counter.sinceFlush, 0);
  assert.equal(counter.flush(), null);
});

test('snapshot returns a fresh object each call', () => {
  const { counter } = makeCounter();
  counter.drop('a');
  const first = counter.snapshot();
  first.byReason.a = 999;
  first.total = 999;
  assert.deepEqual(counter.snapshot(), { total: 1, byReason: { a: 1 } });
});

test('constructor rejects invalid options', () => {
  assert.throws(() => new DroppedSampleCounter({ flushInterval: -1 }), TypeError);
  assert.throws(() => new DroppedSampleCounter({ flushInterval: 1.5 }), TypeError);
  assert.throws(() => new DroppedSampleCounter({ onFlush: 42 }), TypeError);
  assert.throws(() => new DroppedSampleCounter({ now: 'nope' }), TypeError);
});
