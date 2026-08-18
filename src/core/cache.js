/**
 * Short-lived response cache backed by chrome.storage.session.
 *
 * session storage lives in memory and is cleared when the browser closes, so
 * repository listings never touch disk — unlike storage.local, which is where
 * the credentials already unavoidably live.
 */

const TTL_MS = 5 * 60 * 1000;

export const cacheKeys = {
  repositories: (registryId) => `repos:${registryId}`,
  tags: (registryId, repository) => `tags:${registryId}:${repository}`,
};

/**
 * @returns {Promise<unknown|null>} The cached value, or null when absent or stale.
 */
export async function cacheGet(key) {
  const stored = await chrome.storage.session.get(key);
  const entry = stored[key];
  if (!entry || Date.now() - entry.fetchedAt > TTL_MS) return null;
  return entry.value;
}

export async function cacheSet(key, value) {
  await chrome.storage.session.set({ [key]: { fetchedAt: Date.now(), value } });
}

/** Drops every cached entry belonging to one registry. */
export async function cacheClearRegistry(registryId) {
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all).filter(
    (key) => key === cacheKeys.repositories(registryId) || key.startsWith(`tags:${registryId}:`),
  );
  if (keys.length) await chrome.storage.session.remove(keys);
}
