import test from 'node:test';
import assert from 'node:assert/strict';
import { railTags, PREVIEW_LIMIT } from '../src/core/rail.js';

const many = (n) => Array.from({ length: n }, (_, i) => `1.0.${n - i}`);

test('a short list is shown whole, with no toggle', () => {
  const tags = many(3);
  assert.deepEqual(railTags(tags), { shown: tags, hidden: 0, collapsible: false });
});

test('a list exactly at the limit still needs no toggle', () => {
  const tags = many(PREVIEW_LIMIT);
  assert.deepEqual(railTags(tags), { shown: tags, hidden: 0, collapsible: false });
});

test('a long list is truncated to the newest few', () => {
  const tags = many(115);
  const { shown, hidden, collapsible } = railTags(tags);
  assert.equal(shown.length, PREVIEW_LIMIT);
  assert.equal(hidden, 115 - PREVIEW_LIMIT);
  assert.equal(collapsible, true);
  // The newest versions are the ones kept — that is the whole point.
  assert.deepEqual(shown, tags.slice(0, PREVIEW_LIMIT));
});

test('expanding shows everything but keeps the toggle', () => {
  const tags = many(115);
  assert.deepEqual(railTags(tags, { expanded: true }), {
    shown: tags, hidden: 0, collapsible: true,
  });
});

test('a filtered list is never truncated — the filter is already the control', () => {
  const tags = many(40);
  assert.deepEqual(railTags(tags, { filtered: true }), {
    shown: tags, hidden: 0, collapsible: false,
  });
});

test('filtering wins over expanded state', () => {
  const tags = many(40);
  assert.deepEqual(railTags(tags, { filtered: true, expanded: true }), {
    shown: tags, hidden: 0, collapsible: false,
  });
});

test('the limit is configurable', () => {
  const tags = many(10);
  const { shown, hidden } = railTags(tags, { limit: 2 });
  assert.deepEqual(shown, tags.slice(0, 2));
  assert.equal(hidden, 8);
});

test('an empty list is handled', () => {
  assert.deepEqual(railTags([]), { shown: [], hidden: 0, collapsible: false });
});

test('the input array is not mutated', () => {
  const tags = many(20);
  const copy = [...tags];
  railTags(tags);
  assert.deepEqual(tags, copy);
});
