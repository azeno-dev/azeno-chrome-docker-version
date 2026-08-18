import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRegistryClient,
  parseNextLink,
  RegistryError,
} from '../src/core/registry-client.js';

/** Builds a fake fetch over a {url: handler|response} route table, recording calls. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, headers: init.headers ?? {} });
    const route = routes[url];
    if (route === undefined) return new Response('not found', { status: 404 });
    const result = typeof route === 'function' ? route(init) : route;
    // A Response body can only be read once, so hand out a fresh clone each
    // time; the stored original is never consumed.
    return result.clone();
  };
  impl.calls = calls;
  return impl;
}

const json = (body, init = {}) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  ...init,
});

const BASE = 'http://localhost:5000';
const basicRegistry = {
  url: BASE, username: 'testuser', password: 'testpass', authMode: 'basic',
};

test('lists catalog repositories', async () => {
  const fetchImpl = fakeFetch({
    [`${BASE}/v2/_catalog?n=200`]: json({ repositories: ['azeno/api', 'azeno/web'] }),
  });
  const client = createRegistryClient({ registry: basicRegistry, fetchImpl });
  assert.deepEqual(await client.listRepositories(), ['azeno/api', 'azeno/web']);
});

test('sends Basic credentials preemptively rather than waiting for a 401', async () => {
  const fetchImpl = fakeFetch({
    [`${BASE}/v2/_catalog?n=200`]: json({ repositories: [] }),
  });
  const client = createRegistryClient({ registry: basicRegistry, fetchImpl });
  await client.listRepositories();
  assert.equal(fetchImpl.calls[0].headers.Authorization, 'Basic dGVzdHVzZXI6dGVzdHBhc3M=');
});

test('normalises a base URL with a trailing slash', async () => {
  const fetchImpl = fakeFetch({
    [`${BASE}/v2/_catalog?n=200`]: json({ repositories: ['a'] }),
  });
  const client = createRegistryClient({
    registry: { ...basicRegistry, url: `${BASE}///` }, fetchImpl,
  });
  assert.deepEqual(await client.listRepositories(), ['a']);
});

test('follows Link rel=next pagination across catalog pages', async () => {
  const fetchImpl = fakeFetch({
    [`${BASE}/v2/_catalog?n=200`]: json(
      { repositories: ['a'] },
      { headers: { Link: '</v2/_catalog?n=200&last=a>; rel="next"' } },
    ),
    [`${BASE}/v2/_catalog?n=200&last=a`]: json(
      { repositories: ['b'] },
      { headers: { Link: '</v2/_catalog?n=200&last=b>; rel="next"' } },
    ),
    [`${BASE}/v2/_catalog?n=200&last=b`]: json({ repositories: ['c'] }),
  });
  const client = createRegistryClient({ registry: basicRegistry, fetchImpl });
  assert.deepEqual(await client.listRepositories(), ['a', 'b', 'c']);
});

test('stops paginating if the registry points at the page it just served', async () => {
  const fetchImpl = fakeFetch({
    [`${BASE}/v2/_catalog?n=200`]: json(
      { repositories: ['a'] },
      { headers: { Link: '</v2/_catalog?n=200>; rel="next"' } },
    ),
  });
  const client = createRegistryClient({ registry: basicRegistry, fetchImpl });
  assert.deepEqual(await client.listRepositories(), ['a']);
  assert.equal(fetchImpl.calls.length, 1);
});

test('reports a blocked catalog endpoint distinctly so the UI can offer the manual list', async () => {
  for (const status of [403, 404, 405]) {
    const fetchImpl = fakeFetch({
      [`${BASE}/v2/_catalog?n=200`]: new Response('nope', { status }),
    });
    const client = createRegistryClient({ registry: basicRegistry, fetchImpl });
    const error = await client.listRepositories().then(() => null, (e) => e);
    assert.ok(error instanceof RegistryError, `status ${status} should raise RegistryError`);
    assert.equal(error.kind, 'catalog-disabled', `status ${status}`);
  }
});

test('lists tags newest-first', async () => {
  const fetchImpl = fakeFetch({
    [`${BASE}/v2/azeno/api/tags/list?n=200`]: json({
      name: 'azeno/api',
      tags: ['1.0.0', '1.10.0', '1.2.0', 'latest'],
    }),
  });
  const client = createRegistryClient({ registry: basicRegistry, fetchImpl });
  assert.deepEqual(await client.listTags('azeno/api'), ['latest', '1.10.0', '1.2.0', '1.0.0']);
});

test('treats a null tags field as an empty list', async () => {
  const fetchImpl = fakeFetch({
    [`${BASE}/v2/empty/tags/list?n=200`]: json({ name: 'empty', tags: null }),
  });
  const client = createRegistryClient({ registry: basicRegistry, fetchImpl });
  assert.deepEqual(await client.listTags('empty'), []);
});

test('follows pagination for tags too', async () => {
  const fetchImpl = fakeFetch({
    [`${BASE}/v2/azeno/api/tags/list?n=200`]: json(
      { tags: ['1.0.0'] },
      { headers: { Link: '</v2/azeno/api/tags/list?n=200&last=1.0.0>; rel="next"' } },
    ),
    [`${BASE}/v2/azeno/api/tags/list?n=200&last=1.0.0`]: json({ tags: ['2.0.0'] }),
  });
  const client = createRegistryClient({ registry: basicRegistry, fetchImpl });
  assert.deepEqual(await client.listTags('azeno/api'), ['2.0.0', '1.0.0']);
});

test('escapes unsafe characters in a repository name but keeps path slashes', async () => {
  const fetchImpl = fakeFetch({
    [`${BASE}/v2/a%20b/c/tags/list?n=200`]: json({ tags: ['1.0.0'] }),
  });
  const client = createRegistryClient({ registry: basicRegistry, fetchImpl });
  assert.deepEqual(await client.listTags('a b/c'), ['1.0.0']);
});

test('reports a missing repository distinctly', async () => {
  const fetchImpl = fakeFetch({
    [`${BASE}/v2/gone/tags/list?n=200`]: new Response('', { status: 404 }),
  });
  const client = createRegistryClient({ registry: basicRegistry, fetchImpl });
  const error = await client.listTags('gone').then(() => null, (e) => e);
  assert.equal(error.kind, 'not-found');
});

test('classifies 401 and 403 as auth failures', async () => {
  for (const status of [401, 403]) {
    const fetchImpl = fakeFetch({
      [`${BASE}/v2/x/tags/list?n=200`]: new Response('', { status }),
    });
    const client = createRegistryClient({ registry: basicRegistry, fetchImpl });
    const error = await client.listTags('x').then(() => null, (e) => e);
    assert.equal(error.kind, 'auth', `status ${status}`);
  }
});

test('classifies a thrown fetch as a network failure', async () => {
  const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  const client = createRegistryClient({ registry: basicRegistry, fetchImpl });
  const error = await client.listRepositories().then(() => null, (e) => e);
  assert.equal(error.kind, 'network');
});

test('classifies an unexpected status as an http failure', async () => {
  const fetchImpl = fakeFetch({
    [`${BASE}/v2/x/tags/list?n=200`]: new Response('boom', { status: 500 }),
  });
  const client = createRegistryClient({ registry: basicRegistry, fetchImpl });
  const error = await client.listTags('x').then(() => null, (e) => e);
  assert.equal(error.kind, 'http');
  assert.equal(error.status, 500);
});

test('exchanges credentials for a Bearer token and reuses it across scopes', async () => {
  const bearerRegistry = {
    url: BASE,
    username: 'u',
    password: 'p',
    authMode: 'bearer',
    authRealm: 'https://auth.example.com/token',
    authService: 'reg.example.com',
  };
  const tokenUrl = 'https://auth.example.com/token?service=reg.example.com&scope=repository%3Aazeno%2Fapi%3Apull';
  const fetchImpl = fakeFetch({
    [tokenUrl]: json({ token: 'tok-123', expires_in: 300 }),
    [`${BASE}/v2/azeno/api/tags/list?n=200`]: (init) => {
      assert.equal(init.headers.Authorization, 'Bearer tok-123');
      return json({ tags: ['1.0.0'] });
    },
  });
  const client = createRegistryClient({ registry: bearerRegistry, fetchImpl });

  await client.listTags('azeno/api');
  await client.listTags('azeno/api');

  // Two tag requests, but only one token exchange.
  assert.equal(fetchImpl.calls.filter((c) => c.url === tokenUrl).length, 1);
  // The token endpoint itself is reached with the user's Basic credentials.
  assert.equal(fetchImpl.calls[0].headers.Authorization, basicAuthFor('u', 'p'));
});

test('re-exchanges a token once it has expired', async () => {
  const bearerRegistry = {
    url: BASE, username: 'u', password: 'p', authMode: 'bearer',
    authRealm: 'https://auth.example.com/token', authService: 'reg',
  };
  const tokenUrl = 'https://auth.example.com/token?service=reg&scope=repository%3Ax%3Apull';
  let clock = 0;
  const fetchImpl = fakeFetch({
    [tokenUrl]: () => json({ token: 'tok', expires_in: 60 }),
    [`${BASE}/v2/x/tags/list?n=200`]: json({ tags: [] }),
  });
  const client = createRegistryClient({ registry: bearerRegistry, fetchImpl, now: () => clock });

  await client.listTags('x');
  clock += 120_000;
  await client.listTags('x');

  assert.equal(fetchImpl.calls.filter((c) => c.url === tokenUrl).length, 2);
});

test('accepts access_token as the token field, as some registries return', async () => {
  const bearerRegistry = {
    url: BASE, username: 'u', password: 'p', authMode: 'bearer',
    authRealm: 'https://auth.example.com/token', authService: 'reg',
  };
  const fetchImpl = fakeFetch({
    'https://auth.example.com/token?service=reg&scope=repository%3Ax%3Apull': json({ access_token: 'alt' }),
    [`${BASE}/v2/x/tags/list?n=200`]: (init) => {
      assert.equal(init.headers.Authorization, 'Bearer alt');
      return json({ tags: [] });
    },
  });
  const client = createRegistryClient({ registry: bearerRegistry, fetchImpl });
  await client.listTags('x');
});

test('sends no Authorization header for an anonymous registry', async () => {
  const fetchImpl = fakeFetch({
    [`${BASE}/v2/_catalog?n=200`]: json({ repositories: [] }),
  });
  const client = createRegistryClient({
    registry: { url: BASE, authMode: 'none' }, fetchImpl,
  });
  await client.listRepositories();
  assert.equal(fetchImpl.calls[0].headers.Authorization, undefined);
});

test('probe detects a Basic registry and verifies the credentials work', async () => {
  let seenAuth;
  const fetchImpl = fakeFetch({
    [`${BASE}/v2/`]: (init) => {
      seenAuth = init.headers.Authorization;
      if (!seenAuth) {
        return new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Registry Realm"' } });
      }
      return json({});
    },
  });
  const client = createRegistryClient({ registry: basicRegistry, fetchImpl });
  assert.deepEqual(await client.probe(), {
    ok: true, authMode: 'basic', authRealm: null, authService: null,
  });
});

test('probe detects a Bearer registry and captures realm and service', async () => {
  const registry = { url: BASE, username: 'u', password: 'p' };
  const fetchImpl = fakeFetch({
    [`${BASE}/v2/`]: (init) => {
      if (!init.headers.Authorization) {
        return new Response('', {
          status: 401,
          headers: {
            'WWW-Authenticate': 'Bearer realm="https://auth.example.com/token",service="reg.example.com"',
          },
        });
      }
      return json({});
    },
    'https://auth.example.com/token?service=reg.example.com&scope=registry%3Acatalog%3A*': json({ token: 't' }),
  });
  const client = createRegistryClient({ registry, fetchImpl });
  assert.deepEqual(await client.probe(), {
    ok: true,
    authMode: 'bearer',
    authRealm: 'https://auth.example.com/token',
    authService: 'reg.example.com',
  });
});

test('probe reports an open registry as needing no auth', async () => {
  const fetchImpl = fakeFetch({ [`${BASE}/v2/`]: json({}) });
  const client = createRegistryClient({ registry: { url: BASE }, fetchImpl });
  assert.deepEqual(await client.probe(), {
    ok: true, authMode: 'none', authRealm: null, authService: null,
  });
});

test('probe reports bad credentials rather than throwing', async () => {
  const fetchImpl = fakeFetch({
    [`${BASE}/v2/`]: new Response('', {
      status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Registry Realm"' },
    }),
  });
  const client = createRegistryClient({ registry: basicRegistry, fetchImpl });
  const result = await client.probe();
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'auth');
});

test('probe reports an unreachable host rather than throwing', async () => {
  const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  const client = createRegistryClient({ registry: basicRegistry, fetchImpl });
  const result = await client.probe();
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'network');
});

test('parseNextLink resolves a relative link against the current page URL', () => {
  assert.equal(
    parseNextLink('</v2/_catalog?n=200&last=a>; rel="next"', 'http://localhost:5000/v2/_catalog?n=200'),
    'http://localhost:5000/v2/_catalog?n=200&last=a',
  );
});

test('parseNextLink accepts an absolute link and an unquoted rel', () => {
  assert.equal(
    parseNextLink('<https://other/v2/_catalog?last=z>; rel=next', 'http://localhost:5000/v2/_catalog'),
    'https://other/v2/_catalog?last=z',
  );
});

test('parseNextLink picks the next relation out of several', () => {
  const header = '</v2/_catalog?last=a>; rel="prev", </v2/_catalog?last=c>; rel="next"';
  assert.equal(
    parseNextLink(header, 'http://localhost:5000/v2/_catalog'),
    'http://localhost:5000/v2/_catalog?last=c',
  );
});

test('parseNextLink returns null when there is no next page', () => {
  assert.equal(parseNextLink(null, 'http://localhost:5000/v2/_catalog'), null);
  assert.equal(parseNextLink('', 'http://localhost:5000/v2/_catalog'), null);
  assert.equal(parseNextLink('</v2/_catalog?last=a>; rel="prev"', 'http://localhost:5000/v2/_catalog'), null);
});

function basicAuthFor(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}
