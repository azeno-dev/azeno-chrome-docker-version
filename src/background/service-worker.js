/**
 * Message router. Every registry request goes through here rather than through
 * the popup, so a fetch in flight is not cancelled when the popup closes and the
 * Bearer token cache has a single owner.
 *
 * Token caches are held in memory: when the service worker is evicted after idle
 * they are lost and the next request re-exchanges, which costs one extra round
 * trip and avoids persisting bearer tokens anywhere.
 */

import { createRegistryClient } from '../core/registry-client.js';
import { groupRepositories } from '../core/grouping.js';
import { getRegistry, saveRegistry } from '../core/settings.js';
import { cacheGet, cacheSet, cacheKeys, cacheClearRegistry } from '../core/cache.js';

/** @type {Map<string, Map<string, {token:string, expiresAt:number}>>} */
const tokenCaches = new Map();

function tokenCacheFor(registryId) {
  if (!tokenCaches.has(registryId)) tokenCaches.set(registryId, new Map());
  return tokenCaches.get(registryId);
}

function clientFor(registry) {
  return createRegistryClient({
    registry,
    tokenCache: tokenCacheFor(registry.id ?? 'unsaved'),
  });
}

async function loadRegistry(registryId) {
  const registry = await getRegistry(registryId);
  if (!registry) {
    const error = new Error('That registry is no longer configured.');
    error.kind = 'not-found';
    throw error;
  }
  return registry;
}

const handlers = {
  /** Groups the catalog (or the manually configured repository list). */
  async listRepos({ registryId, force }) {
    const registry = await loadRegistry(registryId);
    if (force) await cacheClearRegistry(registryId);

    if (registry.manualRepositories?.length) {
      return {
        groups: groupRepositories(registry.manualRepositories),
        source: 'manual',
      };
    }

    const key = cacheKeys.repositories(registryId);
    let repositories = await cacheGet(key);
    if (!repositories) {
      repositories = await clientFor(registry).listRepositories();
      await cacheSet(key, repositories);
    }
    return { groups: groupRepositories(repositories), source: 'catalog' };
  },

  /** One repository per message so the popup can render results as they land. */
  async listTags({ registryId, repository, force }) {
    const registry = await loadRegistry(registryId);
    const key = cacheKeys.tags(registryId, repository);
    if (!force) {
      const cached = await cacheGet(key);
      if (cached) return { tags: cached };
    }
    const tags = await clientFor(registry).listTags(repository);
    await cacheSet(key, tags);
    return { tags };
  },

  /**
   * Probes an unsaved registry from the options page. On success the detected
   * auth mode is persisted so later requests skip the challenge round trip.
   */
  async testConnection({ registry }) {
    const result = await clientFor(registry).probe();
    if (result.ok && registry.id) {
      const stored = await getRegistry(registry.id);
      if (stored) {
        await saveRegistry({
          ...stored,
          authMode: result.authMode,
          authRealm: result.authRealm,
          authService: result.authService,
        });
      }
    }
    return result;
  },

  async clearCache({ registryId }) {
    await cacheClearRegistry(registryId);
    tokenCaches.delete(registryId);
    return { ok: true };
  },
};

function serialiseError(error) {
  return {
    kind: error.kind ?? 'http',
    message: error.message ?? 'Something went wrong.',
    status: error.status,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) {
    sendResponse({ error: { kind: 'http', message: `Unknown request "${message?.type}".` } });
    return false;
  }
  handler(message).then(sendResponse, (error) => sendResponse({ error: serialiseError(error) }));
  return true; // Keeps the message channel open for the async response.
});

// A fresh install has nothing to show, so send the user straight to setup.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;
  const { registries } = await chrome.storage.local.get('registries');
  if (!registries?.length) chrome.runtime.openOptionsPage();
});
