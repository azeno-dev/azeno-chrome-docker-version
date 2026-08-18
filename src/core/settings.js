/**
 * Registry configuration, persisted in chrome.storage.local.
 *
 * Credentials are stored in plain text. Chrome offers extensions no secure
 * keystore, so anyone with read access to the browser profile directory can
 * recover them — the options page says so, and a pull-only robot token is the
 * right thing to put here rather than a personal password.
 *
 * @typedef {object} Registry
 * @property {string} id
 * @property {string} name
 * @property {string} url
 * @property {string} username
 * @property {string} password
 * @property {'none'|'basic'|'bearer'} authMode
 * @property {string|null} authRealm
 * @property {string|null} authService
 * @property {string[]} manualRepositories Used instead of /v2/_catalog when non-empty.
 */

const REGISTRIES_KEY = 'registries';
const SELECTED_KEY = 'selectedRegistryId';

/** @returns {Promise<Registry[]>} */
export async function getRegistries() {
  const stored = await chrome.storage.local.get(REGISTRIES_KEY);
  return stored[REGISTRIES_KEY] ?? [];
}

/** @returns {Promise<Registry|null>} */
export async function getRegistry(id) {
  const registries = await getRegistries();
  return registries.find((registry) => registry.id === id) ?? null;
}

/**
 * Inserts or updates a registry, assigning an id when it is new.
 * @param {Partial<Registry>} registry
 * @returns {Promise<Registry>} The stored record.
 */
export async function saveRegistry(registry) {
  const registries = await getRegistries();
  const record = {
    id: registry.id || crypto.randomUUID(),
    name: (registry.name || '').trim() || hostOf(registry.url) || 'Registry',
    url: (registry.url || '').trim().replace(/\/+$/, ''),
    username: registry.username ?? '',
    password: registry.password ?? '',
    authMode: registry.authMode ?? 'none',
    authRealm: registry.authRealm ?? null,
    authService: registry.authService ?? null,
    manualRepositories: registry.manualRepositories ?? [],
  };

  const index = registries.findIndex((existing) => existing.id === record.id);
  if (index === -1) registries.push(record);
  else registries[index] = record;

  await chrome.storage.local.set({ [REGISTRIES_KEY]: registries });
  return record;
}

export async function deleteRegistry(id) {
  const registries = (await getRegistries()).filter((registry) => registry.id !== id);
  await chrome.storage.local.set({ [REGISTRIES_KEY]: registries });
  if (await getSelectedRegistryId() === id) {
    await setSelectedRegistryId(registries[0]?.id ?? null);
  }
}

/** @returns {Promise<string|null>} The remembered registry, falling back to the first. */
export async function getSelectedRegistryId() {
  const stored = await chrome.storage.local.get(SELECTED_KEY);
  const selected = stored[SELECTED_KEY] ?? null;
  const registries = await getRegistries();
  if (selected && registries.some((registry) => registry.id === selected)) return selected;
  return registries[0]?.id ?? null;
}

export async function setSelectedRegistryId(id) {
  await chrome.storage.local.set({ [SELECTED_KEY]: id });
}

/**
 * The host permission pattern for a registry URL. Registry hosts are only known
 * at runtime, so they are requested through optional_host_permissions instead of
 * being declared in the manifest.
 * @returns {string|null} e.g. "http://localhost:5000/*"
 */
export function originPatternFor(url) {
  try {
    return `${new URL(url).origin}/*`;
  } catch {
    return null;
  }
}

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** Splits a textarea/comma list of repository names into a clean array. */
export function parseRepositoryList(text) {
  return String(text ?? '')
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean);
}
