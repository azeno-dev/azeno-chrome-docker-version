/**
 * Tag version parsing and ordering.
 *
 * Registry v2's tags/list returns bare strings with no dates, so ordering has to
 * come from the tag text itself. Tags fall into three ranks, newest first:
 *
 *   0  `latest`          pinned to the top
 *   1  semver-ish        compared numerically, releases above their prereleases
 *   2  everything else   natural sort (build-10 above build-2), descending
 */

// Lenient semver: optional `v`, 1-3 numeric parts, optional prerelease and build.
// Leading zeros are allowed (strict semver forbids them) so `2024.08.1` parses.
const VERSION_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const RANK_LATEST = 0;
const RANK_VERSION = 1;
const RANK_OTHER = 2;

/**
 * @param {string} tag
 * @returns {{major:number, minor:number, patch:number, prerelease:string|null}|null}
 *   null when the tag is not a recognisable version.
 */
export function parseVersion(tag) {
  if (typeof tag !== 'string') return null;
  const match = VERSION_RE.exec(tag.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
    prerelease: match[4] === undefined ? null : match[4],
  };
}

function rankOf(tag, parsed) {
  if (tag.trim().toLowerCase() === 'latest') return RANK_LATEST;
  return parsed ? RANK_VERSION : RANK_OTHER;
}

const NUMERIC_RE = /^\d+$/;

/** Semver §11.4 precedence for the prerelease section. Returns >0 when `a` is newer. */
function comparePrerelease(a, b) {
  // No prerelease outranks any prerelease: 1.0.0 > 1.0.0-rc.1
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  const aParts = a.split('.');
  const bParts = b.split('.');
  for (let i = 0; i < Math.min(aParts.length, bParts.length); i += 1) {
    const x = aParts[i];
    const y = bParts[i];
    if (x === y) continue;
    const xNumeric = NUMERIC_RE.test(x);
    const yNumeric = NUMERIC_RE.test(y);
    if (xNumeric && yNumeric) return Number(x) - Number(y);
    // Numeric identifiers always have lower precedence than alphanumeric ones.
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x < y ? -1 : 1;
  }
  // Equal common prefix: the longer identifier set wins (rc.1 > rc).
  return aParts.length - bParts.length;
}

/** Returns >0 when version `a` is newer than version `b`. */
function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  return comparePrerelease(a.prerelease, b.prerelease);
}

/**
 * Comparator ordering tags newest-first. Negative means `a` sorts before `b`.
 * @param {string} a
 * @param {string} b
 */
export function compareTags(a, b) {
  const aParsed = parseVersion(a);
  const bParsed = parseVersion(b);
  const aRank = rankOf(a, aParsed);
  const bRank = rankOf(b, bParsed);
  if (aRank !== bRank) return aRank - bRank;

  if (aRank === RANK_VERSION) {
    // Negated: compareVersions is ascending, we want newest first.
    const byVersion = -compareVersions(aParsed, bParsed);
    if (byVersion !== 0) return byVersion;
  }
  return collator.compare(b, a);
}

/**
 * @param {string[]} tags
 * @returns {string[]} a new array, newest first.
 */
export function sortTags(tags) {
  return [...tags].sort(compareTags);
}
