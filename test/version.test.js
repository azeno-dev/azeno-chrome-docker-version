import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, sortTags, compareTags } from '../src/core/version.js';

test('parseVersion accepts full semver', () => {
  assert.deepEqual(parseVersion('1.2.3'), {
    major: 1, minor: 2, patch: 3, prerelease: null,
  });
});

test('parseVersion strips a leading v', () => {
  assert.deepEqual(parseVersion('v2.0.1'), {
    major: 2, minor: 0, patch: 1, prerelease: null,
  });
});

test('parseVersion fills in missing minor and patch', () => {
  assert.deepEqual(parseVersion('3'), { major: 3, minor: 0, patch: 0, prerelease: null });
  assert.deepEqual(parseVersion('3.4'), { major: 3, minor: 4, patch: 0, prerelease: null });
});

test('parseVersion keeps the prerelease and discards build metadata', () => {
  assert.deepEqual(parseVersion('1.0.0-rc.1+build.5'), {
    major: 1, minor: 0, patch: 0, prerelease: 'rc.1',
  });
});

test('parseVersion tolerates leading zeros so date tags parse', () => {
  assert.deepEqual(parseVersion('2024.08.1'), {
    major: 2024, minor: 8, patch: 1, prerelease: null,
  });
});

test('parseVersion rejects non-version tags', () => {
  for (const tag of ['latest', 'main-a1b2c3', 'sha-deadbeef', 'nightly', '', 'v', '1.2.3.4', 'release-1.2.3']) {
    assert.equal(parseVersion(tag), null, `expected ${JSON.stringify(tag)} not to parse`);
  }
});

test('sortTags puts latest first, then semver descending, then the rest', () => {
  const input = ['1.0.0', '1.10.0', '1.2.0', '2.0.0', '2.0.0-rc.1', 'latest', 'main-a1b2c3'];
  assert.deepEqual(sortTags(input), [
    'latest',
    '2.0.0',
    '2.0.0-rc.1',
    '1.10.0',
    '1.2.0',
    '1.0.0',
    'main-a1b2c3',
  ]);
});

test('sortTags orders 1.10.0 above 1.9.0 rather than lexically', () => {
  assert.deepEqual(sortTags(['1.9.0', '1.10.0', '1.100.0']), ['1.100.0', '1.10.0', '1.9.0']);
});

test('sortTags ranks a release above its own prereleases', () => {
  assert.deepEqual(
    sortTags(['1.0.0-alpha', '1.0.0', '1.0.0-rc.1', '1.0.0-beta']),
    ['1.0.0', '1.0.0-rc.1', '1.0.0-beta', '1.0.0-alpha'],
  );
});

test('sortTags compares prerelease identifiers by semver rules', () => {
  // numeric identifiers compare numerically and rank below alphanumeric ones
  assert.deepEqual(sortTags(['1.0.0-rc.2', '1.0.0-rc.10']), ['1.0.0-rc.10', '1.0.0-rc.2']);
  assert.deepEqual(sortTags(['1.0.0-1', '1.0.0-alpha']), ['1.0.0-alpha', '1.0.0-1']);
  // a larger set of identifiers wins when the common prefix is equal
  assert.deepEqual(sortTags(['1.0.0-rc', '1.0.0-rc.1']), ['1.0.0-rc.1', '1.0.0-rc']);
});

test('sortTags natural-sorts unparseable tags descending', () => {
  assert.deepEqual(
    sortTags(['build-2', 'build-10', 'build-1']),
    ['build-10', 'build-2', 'build-1'],
  );
});

test('sortTags treats latest case-insensitively and does not mutate its input', () => {
  const input = ['1.0.0', 'LATEST'];
  const output = sortTags(input);
  assert.deepEqual(output, ['LATEST', '1.0.0']);
  assert.deepEqual(input, ['1.0.0', 'LATEST']);
});

test('sortTags handles empty and single-element lists', () => {
  assert.deepEqual(sortTags([]), []);
  assert.deepEqual(sortTags(['only']), ['only']);
});

test('compareTags is usable directly as a sort comparator', () => {
  assert.ok(compareTags('2.0.0', '1.0.0') < 0);
  assert.ok(compareTags('1.0.0', '2.0.0') > 0);
  assert.equal(compareTags('1.0.0', '1.0.0'), 0);
});
