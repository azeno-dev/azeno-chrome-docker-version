/** Repositories are grouped by the namespace before their first slash. */

/** Group name used for repositories that have no namespace prefix. */
export const ROOT_GROUP = '(root)';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * @param {string[]|null|undefined} names Repository names from /v2/_catalog.
 * @returns {{name:string, repos:{full:string, display:string}[]}[]}
 *   Groups sorted alphabetically with the root group last; repos sorted within.
 */
export function groupRepositories(names) {
  if (!Array.isArray(names)) return [];

  const byGroup = new Map();
  const seen = new Set();

  for (const raw of names) {
    if (typeof raw !== 'string') continue;
    const full = raw.trim();
    if (!full || seen.has(full)) continue;
    seen.add(full);

    const slash = full.indexOf('/');
    const group = slash === -1 ? ROOT_GROUP : full.slice(0, slash);
    const display = slash === -1 ? full : full.slice(slash + 1);

    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push({ full, display });
  }

  return [...byGroup.entries()]
    .map(([name, repos]) => ({
      name,
      repos: repos.sort((a, b) => collator.compare(a.display, b.display)),
    }))
    .sort((a, b) => {
      // The root group is a catch-all, so it belongs at the bottom.
      if (a.name === ROOT_GROUP) return 1;
      if (b.name === ROOT_GROUP) return -1;
      return collator.compare(a.name, b.name);
    });
}
