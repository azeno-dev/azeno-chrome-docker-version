/**
 * Bumps the version in manifest.json and package.json together.
 *
 * manifest.json is the one the Chrome Web Store reads; package.json only has to
 * agree. Keeping them in step by hand is how they drift, and the store rejects a
 * version number it has already seen — so this is the single place it changes.
 *
 *   npm run bump          # patch: 0.1.2 -> 0.1.3
 *   npm run bump minor    # 0.1.2 -> 0.2.0
 *   npm run bump major    # 0.1.2 -> 1.0.0
 *   npm run bump 1.4.0    # explicit
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['manifest.json', 'package.json'];
const arg = process.argv[2] ?? 'patch';

const read = (file) => JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
const current = read('manifest.json').version;

function next(version, how) {
  if (/^\d+\.\d+\.\d+$/.test(how)) return how;
  const [major, minor, patch] = version.split('.').map(Number);
  if (how === 'major') return `${major + 1}.0.0`;
  if (how === 'minor') return `${major}.${minor + 1}.0`;
  if (how === 'patch') return `${major}.${minor}.${patch + 1}`;
  console.error(`\n  ✗ Unknown bump "${how}". Use patch, minor, major, or an explicit x.y.z.\n`);
  process.exit(1);
}

const version = next(current, arg);

// Guard against going backwards: the store only accepts increasing versions.
const rank = (v) => v.split('.').map(Number).reduce((a, n) => a * 10000 + n, 0);
if (rank(version) <= rank(current)) {
  console.error(`\n  ✗ ${version} is not newer than ${current}. The store rejects re-used versions.\n`);
  process.exit(1);
}

for (const file of FILES) {
  const data = read(file);
  data.version = version;
  writeFileSync(join(ROOT, file), `${JSON.stringify(data, null, 2)}\n`);
}

console.log(`\n  ${current} -> ${version}   (manifest.json, package.json)\n`);
console.log('  Next:  npm test && npm run package\n');
