import { mapLimit } from '../core/concurrency.js';
import { railTags, PREVIEW_LIMIT } from '../core/rail.js';
import { parseVersion } from '../core/version.js';
import {
  getRegistries, getSelectedRegistryId, setSelectedRegistryId, originPatternFor, hostOf,
} from '../core/settings.js';

const TAG_CONCURRENCY = 6;

const el = {
  select: document.getElementById('registry-select'),
  refresh: document.getElementById('refresh'),
  options: document.getElementById('open-options'),
  filter: document.getElementById('filter'),
  content: document.getElementById('content'),
  toast: document.getElementById('toast'),
};

const state = {
  registry: null,
  groups: [],
  /** @type {Map<string, {tags?: string[], error?: string}>} */
  repoData: new Map(),
  expanded: new Set(),
  /** Repositories whose full version list the user has asked to see. */
  expandedRepos: new Set(),
  filter: '',
};

/** Unwraps the service worker's `{error}` envelope into a thrown error. */
async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) {
    throw Object.assign(new Error(response.error.message), response.error);
  }
  return response;
}

// ---- rendering ---------------------------------------------------------

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function showState(title, body, action) {
  clear(el.content);
  const wrap = document.createElement('div');
  wrap.className = 'state';

  const heading = document.createElement('p');
  heading.className = 'state__title';
  heading.textContent = title;
  wrap.append(heading);

  if (body) {
    const text = document.createElement('p');
    text.className = 'state__body';
    text.textContent = body;
    wrap.append(text);
  }

  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'state__action';
    button.textContent = action.label;
    button.addEventListener('click', action.onClick);
    wrap.append(button);
  }

  el.content.append(wrap);
}

function showLoading(message) {
  clear(el.content);
  const node = document.createElement('p');
  node.className = 'loading';
  node.textContent = message;
  el.content.append(node);
}

/** Tags arrive newest-first, so the first non-`latest` tag is the newest release. */
function newestTag(tags) {
  return tags.find((tag) => tag.toLowerCase() !== 'latest') ?? null;
}

function chipClass(tag, newest) {
  if (tag.toLowerCase() === 'latest') return 'chip is-latest';
  const classes = ['chip'];
  if (tag === newest) classes.push('is-newest');
  if (parseVersion(tag)?.prerelease) classes.push('is-prerelease');
  return classes.join(' ');
}

function matches(text) {
  return !state.filter || text.toLowerCase().includes(state.filter);
}

function renderRail(rail, repo) {
  clear(rail);
  const data = state.repoData.get(repo);

  if (!data) {
    rail.append(note('rail__empty', 'Loading versions…'));
    return;
  }
  if (data.error) {
    rail.append(note('rail__error', data.error));
    return;
  }

  // A filter matching the repository name shows all of its versions; otherwise
  // only the versions that match are worth showing.
  const narrowed = matches(repo) ? data.tags : data.tags.filter(matches);
  if (!narrowed.length) {
    rail.append(note('rail__empty', data.tags.length ? 'No matching versions' : 'No versions pushed'));
    return;
  }

  const { shown, hidden, collapsible } = railTags(narrowed, {
    expanded: state.expandedRepos.has(repo),
    filtered: Boolean(state.filter) && !matches(repo),
  });

  // "Newest" is judged against the full list, so filtering never promotes an
  // older version into the newest slot.
  const newest = newestTag(data.tags);
  for (const tag of shown) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = chipClass(tag, newest);
    chip.textContent = tag;
    chip.title = `Copy docker pull for ${tag}`;
    chip.addEventListener('click', () => copyPullCommand(repo, tag));
    rail.append(chip);
  }

  if (hidden > 0) {
    rail.append(moreChip(`+${hidden} more`, repo));
  } else if (collapsible) {
    rail.append(moreChip('Show fewer', repo));
  }
}

/** The trailing control that opens or closes a long version list. */
function moreChip(label, repo) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip chip--more';
  chip.textContent = label;
  chip.addEventListener('click', () => toggleRepo(repo));
  return chip;
}

function toggleRepo(repo) {
  if (state.expandedRepos.has(repo)) state.expandedRepos.delete(repo);
  else state.expandedRepos.add(repo);
  render();
}

function note(className, text) {
  const node = document.createElement('p');
  node.className = className;
  node.textContent = text;
  return node;
}

/** A repository is visible when its own name matches, or one of its loaded tags does. */
function repoVisible(repo) {
  if (matches(repo)) return true;
  const data = state.repoData.get(repo);
  return Boolean(data?.tags?.some(matches));
}

function visibleRepos(group) {
  if (!state.filter) return group.repos;
  return group.repos.filter((repo) => matches(group.name) || repoVisible(repo.full));
}

function render() {
  clear(el.content);

  const groups = state.groups
    .map((group) => ({ group, repos: visibleRepos(group) }))
    .filter(({ group, repos }) => repos.length || matches(group.name));

  if (!groups.length) {
    showState(
      state.filter ? 'Nothing matches that filter' : 'This registry has no repositories',
      state.filter ? 'Try a shorter search.' : 'Push an image and refresh.',
    );
    return;
  }

  const groupTemplate = document.getElementById('group-template');
  const repoTemplate = document.getElementById('repo-template');

  for (const { group, repos } of groups) {
    const node = groupTemplate.content.cloneNode(true);
    const head = node.querySelector('.group__head');
    const body = node.querySelector('.group__body');
    // A filter has to search the whole registry, so it opens every group it
    // keeps; collapsed groups would hide the very matches being looked for.
    const expanded = state.expanded.has(group.name) || Boolean(state.filter);

    node.querySelector('.group__name').textContent = group.name;
    node.querySelector('.group__count').textContent = String(repos.length);
    head.setAttribute('aria-expanded', String(expanded));
    head.addEventListener('click', () => toggleGroup(group));
    body.hidden = !expanded;

    if (expanded) {
      for (const repo of repos) {
        const repoNode = repoTemplate.content.cloneNode(true);
        const repoHead = repoNode.querySelector('.repo__head');
        const rail = repoNode.querySelector('.repo__rail');
        const data = state.repoData.get(repo.full);
        const open = state.expandedRepos.has(repo.full);

        repoNode.querySelector('.repo__name').textContent = repo.display;
        repoNode.querySelector('.repo__count').textContent = data?.tags
          ? String(data.tags.length)
          : '';

        // Only offer a toggle when there is something hidden to reveal.
        const longList = (data?.tags?.length ?? 0) > PREVIEW_LIMIT && !state.filter;
        repoHead.classList.toggle('repo__head--static', !longList);
        repoHead.setAttribute('aria-expanded', String(open));
        if (longList) {
          repoHead.addEventListener('click', () => toggleRepo(repo.full));
        } else {
          repoHead.disabled = true;
        }

        renderRail(rail, repo.full);
        body.append(repoNode);
      }
    }
    el.content.append(node);
  }
}

// ---- data --------------------------------------------------------------

async function toggleGroup(group) {
  if (state.expanded.has(group.name)) {
    state.expanded.delete(group.name);
    render();
    return;
  }
  state.expanded.add(group.name);
  render();
  await loadTags(group);
}

/**
 * Filtering matches tag names, but tags are only fetched when a group is opened.
 * Without this sweep a version search silently misses every group the user has
 * not expanded by hand. Guarded so keystrokes do not stack up sweeps.
 */
let tagSweep = null;
function ensureAllTagsLoaded() {
  if (tagSweep) return tagSweep;
  tagSweep = (async () => {
    for (const group of state.groups) {
      await loadTags(group);
    }
  })().finally(() => { tagSweep = null; });
  return tagSweep;
}

/** Fetches one repository per message so each rail renders the moment it lands. */
async function loadTags(group, force = false) {
  const pending = group.repos.filter((repo) => force || !state.repoData.has(repo.full));
  if (!pending.length) return;

  await mapLimit(pending, TAG_CONCURRENCY, async (repo) => {
    try {
      const { tags } = await send({
        type: 'listTags',
        registryId: state.registry.id,
        repository: repo.full,
        force,
      });
      state.repoData.set(repo.full, { tags });
    } catch (error) {
      state.repoData.set(repo.full, { error: error.message });
    }
    render();
  });
}

function describe(error) {
  switch (error.kind) {
    case 'auth':
      return {
        title: 'The registry rejected the credentials',
        body: 'Check the username and token for this registry.',
        action: { label: 'Open options', onClick: () => chrome.runtime.openOptionsPage() },
      };
    case 'network':
      return {
        title: 'Could not reach the registry',
        body: error.message,
        action: { label: 'Open options', onClick: () => chrome.runtime.openOptionsPage() },
      };
    case 'catalog-disabled':
      return {
        title: 'This registry does not list its catalog',
        body: 'Add the repository names by hand in options and they will show up here.',
        action: { label: 'Open options', onClick: () => chrome.runtime.openOptionsPage() },
      };
    default:
      return {
        title: 'The registry returned an error',
        body: error.message,
        action: { label: 'Open options', onClick: () => chrome.runtime.openOptionsPage() },
      };
  }
}

async function loadRepositories(force = false) {
  el.refresh.classList.add('is-busy');
  showLoading('Reading catalog…');
  state.repoData.clear();

  try {
    const origin = originPatternFor(state.registry.url);
    if (origin && !(await chrome.permissions.contains({ origins: [origin] }))) {
      showState(
        'Chrome needs permission for this host',
        `Grant access to ${hostOf(state.registry.url)} so the extension can read its catalog.`,
        {
          label: 'Grant access',
          onClick: async () => {
            const granted = await chrome.permissions.request({ origins: [origin] });
            if (granted) loadRepositories(force);
          },
        },
      );
      return;
    }

    const { groups } = await send({ type: 'listRepos', registryId: state.registry.id, force });
    state.groups = groups;

    // With a single group there is nothing to choose between — open it.
    if (groups.length === 1) state.expanded.add(groups[0].name);
    render();
    for (const name of state.expanded) {
      const group = groups.find((candidate) => candidate.name === name);
      if (group) await loadTags(group, force);
    }
  } catch (error) {
    const { title, body, action } = describe(error);
    showState(title, body, action);
  } finally {
    el.refresh.classList.remove('is-busy');
  }
}

// ---- actions -----------------------------------------------------------

let toastTimer;
function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 1400);
}

async function copyPullCommand(repository, tag) {
  const command = `docker pull ${hostOf(state.registry.url)}/${repository}:${tag}`;
  try {
    await navigator.clipboard.writeText(command);
    toast('Copied');
  } catch {
    toast('Could not copy');
  }
}

async function selectRegistry(id) {
  const registries = await getRegistries();
  state.registry = registries.find((registry) => registry.id === id) ?? null;
  state.groups = [];
  state.expanded.clear();
  state.repoData.clear();
  await setSelectedRegistryId(id);
  await loadRepositories();
}

async function init() {
  el.options.addEventListener('click', () => chrome.runtime.openOptionsPage());
  el.refresh.addEventListener('click', () => loadRepositories(true));
  el.select.addEventListener('change', (event) => selectRegistry(event.target.value));
  el.filter.addEventListener('input', (event) => {
    state.filter = event.target.value.trim().toLowerCase();
    render();
    if (state.filter) ensureAllTagsLoaded();
  });

  const registries = await getRegistries();
  if (!registries.length) {
    el.select.hidden = true;
    showState('No registries yet', 'Add your registry URL and credentials to get started.', {
      label: 'Add a registry',
      onClick: () => chrome.runtime.openOptionsPage(),
    });
    return;
  }

  for (const registry of registries) {
    const option = document.createElement('option');
    option.value = registry.id;
    option.textContent = registry.name;
    el.select.append(option);
  }

  const selected = await getSelectedRegistryId();
  el.select.value = selected;
  await selectRegistry(selected);
}

init();
