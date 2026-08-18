import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWwwAuthenticate,
  basicHeader,
  catalogScope,
  repositoryScope,
  buildTokenUrl,
} from '../src/core/auth.js';

test('parses a Basic challenge', () => {
  assert.deepEqual(parseWwwAuthenticate('Basic realm="Registry Realm"'), {
    scheme: 'basic',
    params: { realm: 'Registry Realm' },
  });
});

test('parses a Bearer challenge with realm and service', () => {
  const header = 'Bearer realm="https://auth.example.com/token",service="registry.example.com"';
  assert.deepEqual(parseWwwAuthenticate(header), {
    scheme: 'bearer',
    params: { realm: 'https://auth.example.com/token', service: 'registry.example.com' },
  });
});

test('keeps commas that live inside a quoted value', () => {
  const header = 'Bearer realm="https://a/token",scope="repository:x/y:pull,push",error="insufficient_scope"';
  const parsed = parseWwwAuthenticate(header);
  assert.equal(parsed.params.scope, 'repository:x/y:pull,push');
  assert.equal(parsed.params.error, 'insufficient_scope');
});

test('accepts unquoted values and odd spacing', () => {
  const parsed = parseWwwAuthenticate('Bearer  realm=https://a/token ,  service=reg');
  assert.deepEqual(parsed, {
    scheme: 'bearer',
    params: { realm: 'https://a/token', service: 'reg' },
  });
});

test('lowercases the scheme but preserves value case', () => {
  const parsed = parseWwwAuthenticate('BEARER realm="https://Auth.Example.com/token"');
  assert.equal(parsed.scheme, 'bearer');
  assert.equal(parsed.params.realm, 'https://Auth.Example.com/token');
});

test('returns null for a missing or empty header', () => {
  assert.equal(parseWwwAuthenticate(null), null);
  assert.equal(parseWwwAuthenticate(''), null);
  assert.equal(parseWwwAuthenticate('   '), null);
});

test('handles a scheme with no parameters', () => {
  assert.deepEqual(parseWwwAuthenticate('Negotiate'), { scheme: 'negotiate', params: {} });
});

test('basicHeader base64-encodes user:password', () => {
  assert.equal(basicHeader('testuser', 'testpass'), 'Basic dGVzdHVzZXI6dGVzdHBhc3M=');
});

test('basicHeader encodes non-ASCII credentials as UTF-8', () => {
  const header = basicHeader('user', 'pässwörd');
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  assert.equal(decoded, 'user:pässwörd');
});

test('scopes match the registry token spec', () => {
  assert.equal(catalogScope(), 'registry:catalog:*');
  assert.equal(repositoryScope('azeno/api'), 'repository:azeno/api:pull');
});

test('buildTokenUrl adds service and scope without dropping existing query params', () => {
  const url = new URL(buildTokenUrl('https://auth.example.com/token?foo=1', 'reg.example.com', 'registry:catalog:*'));
  assert.equal(url.origin + url.pathname, 'https://auth.example.com/token');
  assert.equal(url.searchParams.get('foo'), '1');
  assert.equal(url.searchParams.get('service'), 'reg.example.com');
  assert.equal(url.searchParams.get('scope'), 'registry:catalog:*');
});

test('buildTokenUrl omits service when the challenge did not provide one', () => {
  const url = new URL(buildTokenUrl('https://auth.example.com/token', null, 'registry:catalog:*'));
  assert.equal(url.searchParams.has('service'), false);
  assert.equal(url.searchParams.get('scope'), 'registry:catalog:*');
});
