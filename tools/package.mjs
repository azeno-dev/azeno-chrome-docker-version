/**
 * Builds the signed .crx to upload to the Chrome Web Store.
 *
 * This item is opted in to verified CRX uploads, so a .zip is rejected. Run
 * `npm run package` and upload the file it names — nothing else.
 *
 * Stages only the runtime files (Chrome's --pack-extension packs a directory
 * wholesale, so pointing it at the repo root would ship the tests and store
 * assets), signs with privatekey.pem, then verifies the result before saying so.
 */

import { execFileSync } from 'node:child_process';
import {
  rmSync, mkdirSync, cpSync, existsSync, readFileSync, renameSync, unlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = join(ROOT, 'dist');
const KEY = join(ROOT, 'privatekey.pem');

// Only these ship. Everything else in the repo is tooling, tests, or docs.
const SHIPPED = ['manifest.json', 'src', 'icons'];

const CHROME = process.env.CHROME
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const fail = (message) => {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
};

// ---- preconditions ------------------------------------------------------

if (!existsSync(KEY)) {
  fail(`No signing key at ${KEY}.\n    This item requires a CRX signed with the key registered under\n    Verified CRX Uploads. See DEPLOY.md.`);
}
if (!existsSync(CHROME)) {
  fail(`Chrome not found at ${CHROME}.\n    Set CHROME=/path/to/chrome and re-run.`);
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const { version } = manifest;
const outName = `registry-versions-${version}.crx`;
const outPath = join(ROOT, outName);

// ---- stage --------------------------------------------------------------

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE);
for (const entry of SHIPPED) {
  cpSync(join(ROOT, entry), join(STAGE, entry), { recursive: true });
}
rmSync(join(ROOT, 'dist.crx'), { force: true });

// ---- pack ---------------------------------------------------------------

try {
  execFileSync(CHROME, [`--pack-extension=${STAGE}`, `--pack-extension-key=${KEY}`], {
    stdio: 'pipe',
  });
} catch (error) {
  fail(`Chrome failed to pack: ${error.message}`);
}

if (!existsSync(join(ROOT, 'dist.crx'))) {
  fail('Chrome did not produce dist.crx. Is another Chrome instance holding the profile?');
}
rmSync(outPath, { force: true });
renameSync(join(ROOT, 'dist.crx'), outPath);
rmSync(STAGE, { recursive: true, force: true });
// Chrome writes a sibling key only when it generated one; never leave it around.
rmSync(join(ROOT, 'dist.pem'), { force: true });

// ---- verify -------------------------------------------------------------

const crx = readFileSync(outPath);
const checks = [];
const check = (label, ok, detail = '') => {
  checks.push({ label, ok, detail });
  if (!ok) process.exitCode = 1;
};

check('CRX3 container', crx.subarray(0, 4).toString() === 'Cr24' && crx.readUInt32LE(4) === 3);

const headerLength = crx.readUInt32LE(8);
const header = crx.subarray(12, 12 + headerLength);
const payload = crx.subarray(12 + headerLength);

/** Minimal protobuf walk to pull the RSA public key out of the CRX header. */
function embeddedPublicKey(buffer) {
  const readVarint = (buf, i) => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = buf[i];
      i += 1;
      result |= (byte & 0x7f) << shift;
      if (!(byte & 0x80)) return [result, i];
      shift += 7;
    }
  };
  let i = 0;
  while (i < buffer.length) {
    const [tag, afterTag] = readVarint(buffer, i);
    i = afterTag;
    if ((tag & 7) !== 2) return null;
    const [length, afterLength] = readVarint(buffer, i);
    i = afterLength;
    const value = buffer.subarray(i, i + length);
    i += length;
    if (tag >> 3 === 2) { // sha256_with_rsa
      let j = 0;
      const [innerTag, afterInner] = readVarint(value, j);
      j = afterInner;
      const [innerLength, afterInnerLength] = readVarint(value, j);
      j = afterInnerLength;
      if (innerTag >> 3 === 1) return value.subarray(j, j + innerLength);
    }
  }
  return null;
}

const registered = execFileSync('openssl', ['rsa', '-in', KEY, '-pubout', '-outform', 'DER'], {
  stdio: ['ignore', 'pipe', 'ignore'], // openssl chatters "writing RSA key" on stderr
});
const embedded = embeddedPublicKey(header);
check(
  'signed with privatekey.pem',
  Boolean(embedded) && Buffer.compare(embedded, registered) === 0,
  embedded ? `key sha256 ${createHash('sha256').update(embedded).digest('hex').slice(0, 16)}` : 'no RSA proof',
);

check('zip payload intact', payload.subarray(0, 4).toString('hex') === '504b0304');

// Walk the zip central directory to list entries without extracting.
function zipEntries(buffer) {
  const names = [];
  const eocd = buffer.lastIndexOf(Buffer.from('504b0506', 'hex'));
  if (eocd === -1) return names;
  let offset = buffer.readUInt32LE(eocd + 16);
  const count = buffer.readUInt16LE(eocd + 10);
  for (let n = 0; n < count; n += 1) {
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push({
      name: buffer.subarray(offset + 46, offset + 46 + nameLength).toString(),
      localOffset: buffer.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

const entries = zipEntries(payload);
const files = entries.filter((entry) => !entry.name.endsWith('/'));
const forbidden = ['test/', 'tools/', 'store-assets/', 'package.json', 'privatekey.pem', '.pem'];
const leaked = files.filter((f) => forbidden.some((p) => f.name.startsWith(p) || f.name.endsWith(p)));
check('no tests, tooling, keys or docs included', leaked.length === 0, leaked.map((f) => f.name).join(', '));

// Read the packed manifest back out and confirm it matches the working copy.
const manifestEntry = entries.find((entry) => entry.name === 'manifest.json');
let packedManifest = null;
if (manifestEntry) {
  const local = manifestEntry.localOffset;
  const method = payload.readUInt16LE(local + 8);
  const compressed = payload.readUInt32LE(local + 18);
  const uncompressed = payload.readUInt32LE(local + 22);
  const start = local + 30 + payload.readUInt16LE(local + 26) + payload.readUInt16LE(local + 28);
  const raw = method === 0
    ? payload.subarray(start, start + uncompressed)
    : inflateRawSync(payload.subarray(start, start + compressed));
  packedManifest = JSON.parse(raw.toString());
}
check(
  'packed manifest matches working copy',
  packedManifest && JSON.stringify(packedManifest) === JSON.stringify(manifest),
);
check(`version is ${version}`, packedManifest?.version === version);

// ---- report -------------------------------------------------------------

console.log(`\n  registry-versions ${version}\n`);
for (const { label, ok, detail } of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  (${detail})` : ''}`);
}
console.log(`\n  ${files.length} files, ${(crx.length / 1024).toFixed(1)} KB`);

if (process.exitCode) {
  console.error('\n  ✗ Package failed verification — do not upload it.\n');
} else {
  console.log(`\n  Upload this file, and only this file:\n\n    ${outPath}\n`);
  console.log('  Dashboard → your item → Package → Upload New Package.');
  console.log('  A .zip will be rejected: this item uses verified CRX uploads.\n');
}
