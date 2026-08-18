import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLimit } from '../src/core/concurrency.js';

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('returns results in input order regardless of completion order', async () => {
  const result = await mapLimit([30, 10, 20], 3, async (ms) => {
    await tick(ms);
    return ms;
  });
  assert.deepEqual(result, [30, 10, 20]);
});

test('never runs more than `limit` tasks at once', async () => {
  let active = 0;
  let peak = 0;
  await mapLimit([...Array(10).keys()], 3, async (i) => {
    active += 1;
    peak = Math.max(peak, active);
    await tick(5);
    active -= 1;
    return i;
  });
  assert.equal(peak, 3);
});

test('passes the index to the worker', async () => {
  const seen = [];
  await mapLimit(['a', 'b'], 1, async (item, index) => {
    seen.push([item, index]);
  });
  assert.deepEqual(seen, [['a', 0], ['b', 1]]);
});

test('rejects when a worker throws', async () => {
  await assert.rejects(
    () => mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    }),
    /boom/,
  );
});

test('handles an empty list and a limit larger than the list', async () => {
  assert.deepEqual(await mapLimit([], 4, async (n) => n), []);
  assert.deepEqual(await mapLimit([1, 2], 99, async (n) => n * 2), [2, 4]);
});
