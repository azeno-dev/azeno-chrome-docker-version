import test from 'node:test';
import assert from 'node:assert/strict';
import { groupRepositories, ROOT_GROUP } from '../src/core/grouping.js';

test('groups repositories by their namespace prefix', () => {
  assert.deepEqual(groupRepositories(['azeno/api', 'azeno/web', 'other/thing']), [
    { name: 'azeno', repos: [
      { full: 'azeno/api', display: 'api' },
      { full: 'azeno/web', display: 'web' },
    ] },
    { name: 'other', repos: [{ full: 'other/thing', display: 'thing' }] },
  ]);
});

test('splits on the first slash only, so nested paths stay in the top group', () => {
  assert.deepEqual(groupRepositories(['azeno/team/api']), [
    { name: 'azeno', repos: [{ full: 'azeno/team/api', display: 'team/api' }] },
  ]);
});

test('puts unprefixed repositories in the root group, sorted last', () => {
  const groups = groupRepositories(['standalone', 'azeno/api']);
  assert.deepEqual(groups.map((g) => g.name), ['azeno', ROOT_GROUP]);
  assert.deepEqual(groups[1].repos, [{ full: 'standalone', display: 'standalone' }]);
});

test('sorts groups alphabetically and repositories within each group', () => {
  const groups = groupRepositories(['zeta/b', 'alpha/z', 'alpha/a', 'zeta/a']);
  assert.deepEqual(groups.map((g) => g.name), ['alpha', 'zeta']);
  assert.deepEqual(groups[0].repos.map((r) => r.display), ['a', 'z']);
  assert.deepEqual(groups[1].repos.map((r) => r.display), ['a', 'b']);
});

test('ignores empty and duplicate names', () => {
  assert.deepEqual(groupRepositories(['azeno/api', 'azeno/api', '', '  ']), [
    { name: 'azeno', repos: [{ full: 'azeno/api', display: 'api' }] },
  ]);
});

test('returns an empty array for no repositories', () => {
  assert.deepEqual(groupRepositories([]), []);
  assert.deepEqual(groupRepositories(null), []);
});
