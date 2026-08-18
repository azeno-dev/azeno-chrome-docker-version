/**
 * Docker Registry v2 authentication helpers.
 *
 * A registry answers an unauthenticated `GET /v2/` with 401 and a
 * `WWW-Authenticate` header describing how to authenticate:
 *
 *   Basic  realm="Registry Realm"
 *   Bearer realm="https://auth.example.com/token",service="registry.example.com"
 *
 * For Basic we send the credentials directly. For Bearer we exchange them at the
 * realm for a short-lived token, per request scope.
 */

// key=value pairs where the value is either quoted (and may then contain commas)
// or a bare token running to the next comma or whitespace.
const PARAM_RE = /([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g;

/**
 * @param {string|null|undefined} header
 * @returns {{scheme:string, params:Record<string,string>}|null}
 */
export function parseWwwAuthenticate(header) {
  if (typeof header !== 'string') return null;
  const trimmed = header.trim();
  if (!trimmed) return null;

  const space = trimmed.indexOf(' ');
  const scheme = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  const rest = space === -1 ? '' : trimmed.slice(space + 1);

  const params = {};
  for (const match of rest.matchAll(PARAM_RE)) {
    params[match[1].toLowerCase()] = match[2] !== undefined ? match[2] : match[3];
  }
  return { scheme, params };
}

/** btoa only accepts latin1, so encode to UTF-8 bytes first. */
function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * @param {string} username
 * @param {string} password
 * @returns {string} An `Authorization` header value.
 */
export function basicHeader(username, password) {
  return `Basic ${base64Utf8(`${username ?? ''}:${password ?? ''}`)}`;
}

/** Scope required to read /v2/_catalog. */
export function catalogScope() {
  return 'registry:catalog:*';
}

/** Scope required to read a repository's tags. */
export function repositoryScope(repository) {
  return `repository:${repository}:pull`;
}

/**
 * @param {string} realm Token endpoint from the Bearer challenge.
 * @param {string|null} service
 * @param {string} scope
 * @returns {string} Absolute token-exchange URL.
 */
export function buildTokenUrl(realm, service, scope) {
  const url = new URL(realm);
  if (service) url.searchParams.set('service', service);
  if (scope) url.searchParams.set('scope', scope);
  return url.toString();
}
