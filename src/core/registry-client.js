/**
 * Docker Registry v2 HTTP client.
 *
 * `fetch` is injected so the whole module is testable without a network or a
 * browser. All failures surface as RegistryError with a `kind` the UI can turn
 * into an actionable message.
 */

import {
  parseWwwAuthenticate,
  basicHeader,
  catalogScope,
  repositoryScope,
  buildTokenUrl,
} from './auth.js';
import { sortTags } from './version.js';

const PAGE_SIZE = 200;
const MAX_PAGES = 1000;
const TOKEN_FALLBACK_TTL = 300;
// Refresh slightly early so a token cannot expire mid-request.
const TOKEN_EXPIRY_MARGIN = 30;

// Registries behind a proxy commonly disable _catalog rather than 404 the whole API.
const CATALOG_BLOCKED_STATUSES = new Set([403, 404, 405]);

/** @typedef {'auth'|'network'|'catalog-disabled'|'not-found'|'http'} RegistryErrorKind */

export class RegistryError extends Error {
  /**
   * @param {RegistryErrorKind} kind
   * @param {string} message
   * @param {number} [status]
   */
  constructor(kind, message, status) {
    super(message);
    this.name = 'RegistryError';
    this.kind = kind;
    this.status = status;
  }
}

const LINK_RE = /<([^>]+)>\s*;\s*rel\s*=\s*"?([^",;\s]+)"?/g;

/**
 * @param {string|null} header Value of the `Link` response header.
 * @param {string} currentUrl Used to resolve relative links.
 * @returns {string|null} Absolute URL of the next page, or null.
 */
export function parseNextLink(header, currentUrl) {
  if (!header) return null;
  for (const match of header.matchAll(LINK_RE)) {
    if (match[2].toLowerCase() === 'next') {
      try {
        return new URL(match[1], currentUrl).toString();
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Percent-encodes each path segment while leaving the separators intact. */
function encodeRepositoryName(repository) {
  return String(repository).split('/').map(encodeURIComponent).join('/');
}

/**
 * @param {object} options
 * @param {object} options.registry Stored registry config.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {Map<string, {token:string, expiresAt:number}>} [options.tokenCache]
 * @param {() => number} [options.now]
 */
export function createRegistryClient({
  registry,
  fetchImpl = globalThis.fetch,
  tokenCache = new Map(),
  now = () => Date.now(),
}) {
  const base = String(registry.url ?? '').trim().replace(/\/+$/, '');

  let auth = {
    mode: registry.authMode ?? 'none',
    realm: registry.authRealm ?? null,
    service: registry.authService ?? null,
  };

  /** Wraps fetch so transport failures become a typed error instead of a TypeError. */
  async function safeFetch(url, init) {
    try {
      return await fetchImpl(url, init);
    } catch (cause) {
      throw new RegistryError(
        'network',
        `Could not reach ${url}. Check the URL, your VPN, and — for an https registry with a self-signed certificate — that the certificate is trusted.`,
      );
    }
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      throw new RegistryError(
        'http',
        'The registry returned a response that was not JSON. Is this URL really a Docker registry?',
        response.status,
      );
    }
  }

  async function getBearerToken(scope) {
    const cached = tokenCache.get(scope);
    if (cached && cached.expiresAt > now()) return cached.token;

    if (!auth.realm) {
      throw new RegistryError('auth', 'The registry asked for a Bearer token but gave no token endpoint.');
    }

    const headers = { Accept: 'application/json' };
    // The token endpoint itself is authenticated with the user's credentials.
    if (registry.username) {
      headers.Authorization = basicHeader(registry.username, registry.password);
    }

    const response = await safeFetch(buildTokenUrl(auth.realm, auth.service, scope), {
      headers,
      credentials: 'omit',
    });
    if (!response.ok) {
      throw new RegistryError('auth', `The registry rejected the credentials (HTTP ${response.status}).`, response.status);
    }

    const body = await readJson(response);
    const token = body.token ?? body.access_token;
    if (!token) {
      throw new RegistryError('auth', 'The token endpoint returned no token.');
    }

    const ttl = Number(body.expires_in) > 0 ? Number(body.expires_in) : TOKEN_FALLBACK_TTL;
    tokenCache.set(scope, {
      token,
      expiresAt: now() + Math.max(0, ttl - TOKEN_EXPIRY_MARGIN) * 1000,
    });
    return token;
  }

  async function authorizationFor(scope) {
    if (auth.mode === 'basic') return basicHeader(registry.username, registry.password);
    if (auth.mode === 'bearer') return `Bearer ${await getBearerToken(scope)}`;
    return null;
  }

  /** Credentials go out on the first request; we never wait for a 401 to add them. */
  async function authorizedFetch(url, scope) {
    const headers = { Accept: 'application/json' };
    const authorization = await authorizationFor(scope);
    if (authorization) headers.Authorization = authorization;
    return safeFetch(url, { headers, credentials: 'omit' });
  }

  function assertOk(response) {
    if (response.ok) return;
    if (response.status === 401 || response.status === 403) {
      throw new RegistryError('auth', 'The registry rejected the credentials.', response.status);
    }
    throw new RegistryError('http', `The registry returned HTTP ${response.status}.`, response.status);
  }

  /** Walks `Link: rel="next"` pages, collecting each page's items. */
  async function collectPages(firstUrl, scope, extract, onStatus) {
    const items = [];
    const visited = new Set();
    let url = firstUrl;

    while (url && !visited.has(url) && visited.size < MAX_PAGES) {
      visited.add(url);
      const response = await authorizedFetch(url, scope);
      if (onStatus) onStatus(response);
      assertOk(response);
      const body = await readJson(response);
      items.push(...extract(body));
      url = parseNextLink(response.headers.get('Link'), url);
    }
    return items;
  }

  return {
    /**
     * Detects how the registry wants to be authenticated and confirms the stored
     * credentials actually work. Resolves rather than throws so the options page
     * can render the outcome either way.
     */
    async probe() {
      let challenge;
      try {
        const response = await safeFetch(`${base}/v2/`, {
          headers: { Accept: 'application/json' },
          credentials: 'omit',
        });
        if (response.ok) {
          auth = { mode: 'none', realm: null, service: null };
          return { ok: true, authMode: 'none', authRealm: null, authService: null };
        }
        if (response.status !== 401) {
          return {
            ok: false,
            kind: 'http',
            status: response.status,
            message: `The registry returned HTTP ${response.status} for /v2/.`,
          };
        }
        challenge = parseWwwAuthenticate(response.headers.get('WWW-Authenticate'));
      } catch (error) {
        return { ok: false, kind: error.kind ?? 'network', message: error.message };
      }

      // A 401 with no usable challenge still means "send credentials"; Basic is
      // the safe assumption and matches registries sitting behind a proxy.
      auth = challenge?.scheme === 'bearer'
        ? {
          mode: 'bearer',
          realm: challenge.params.realm ?? null,
          service: challenge.params.service ?? null,
        }
        : { mode: 'basic', realm: null, service: null };
      tokenCache.clear();

      try {
        const response = await authorizedFetch(`${base}/v2/`, catalogScope());
        assertOk(response);
      } catch (error) {
        return {
          ok: false,
          kind: error.kind ?? 'http',
          status: error.status,
          message: error.message,
        };
      }

      return {
        ok: true,
        authMode: auth.mode,
        authRealm: auth.realm,
        authService: auth.service,
      };
    },

    /** @returns {Promise<string[]>} Every repository name in the catalog. */
    async listRepositories() {
      return collectPages(
        `${base}/v2/_catalog?n=${PAGE_SIZE}`,
        catalogScope(),
        (body) => body.repositories ?? [],
        (response) => {
          if (CATALOG_BLOCKED_STATUSES.has(response.status)) {
            throw new RegistryError(
              'catalog-disabled',
              'This registry does not expose /v2/_catalog. List the repositories manually in the extension options.',
              response.status,
            );
          }
        },
      );
    },

    /** @returns {Promise<string[]>} The repository's tags, newest version first. */
    async listTags(repository) {
      const tags = await collectPages(
        `${base}/v2/${encodeRepositoryName(repository)}/tags/list?n=${PAGE_SIZE}`,
        repositoryScope(repository),
        (body) => body.tags ?? [],
        (response) => {
          if (response.status === 404) {
            throw new RegistryError('not-found', `Repository "${repository}" was not found.`, 404);
          }
        },
      );
      return sortTags(tags);
    },
  };
}
