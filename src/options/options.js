import {
  getRegistries, saveRegistry, deleteRegistry, originPatternFor, hostOf, parseRepositoryList,
} from '../core/settings.js';

const el = {
  list: document.getElementById('registry-list'),
  add: document.getElementById('add'),
  editor: document.getElementById('editor'),
  editorTitle: document.getElementById('editor-title'),
  form: document.getElementById('form'),
  id: document.getElementById('registry-id'),
  name: document.getElementById('name'),
  url: document.getElementById('url'),
  username: document.getElementById('username'),
  password: document.getElementById('password'),
  manualRepos: document.getElementById('manual-repos'),
  result: document.getElementById('result'),
  test: document.getElementById('test'),
  cancel: document.getElementById('cancel'),
};

const AUTH_LABELS = {
  basic: 'Basic auth',
  bearer: 'Token auth',
  none: 'No auth',
};

function showResult(message, ok) {
  el.result.textContent = message;
  el.result.className = `result ${ok ? 'is-ok' : 'is-error'}`;
  el.result.hidden = false;
}

function clearResult() {
  el.result.hidden = true;
  el.result.textContent = '';
}

/** Reads the form into a registry-shaped object without persisting it. */
function formValues() {
  return {
    id: el.id.value || '',
    name: el.name.value,
    url: el.url.value.trim().replace(/\/+$/, ''),
    username: el.username.value,
    password: el.password.value,
    manualRepositories: parseRepositoryList(el.manualRepos.value),
  };
}

/**
 * Registry hosts are not in the manifest, so access is granted at runtime. This
 * must run before any `await` in a click handler or Chrome discards the gesture.
 */
function requestHostAccess(url) {
  const origin = originPatternFor(url);
  if (!origin) return Promise.resolve(false);
  return chrome.permissions.request({ origins: [origin] });
}

// ---- list --------------------------------------------------------------

function registryRow(registry) {
  const row = document.createElement('li');
  row.className = 'row';

  const text = document.createElement('div');
  text.className = 'row__text';

  const name = document.createElement('div');
  name.className = 'row__name';
  name.textContent = registry.name;

  const url = document.createElement('div');
  url.className = 'row__url';
  url.textContent = registry.url;

  text.append(name, url);

  const badge = document.createElement('span');
  badge.className = 'row__badge';
  badge.textContent = AUTH_LABELS[registry.authMode] ?? 'Not tested';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'button button--ghost button--small';
  edit.textContent = 'Edit';
  edit.addEventListener('click', () => openEditor(registry));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'button button--danger button--small';
  remove.textContent = 'Delete';
  // Two-step rather than a modal: confirm() would block the page.
  let armed = false;
  remove.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      remove.textContent = 'Confirm delete';
      setTimeout(() => {
        armed = false;
        remove.textContent = 'Delete';
      }, 4000);
      return;
    }
    await deleteRegistry(registry.id);
    if (el.id.value === registry.id) closeEditor();
    await renderList();
  });

  row.append(text, badge, edit, remove);
  return row;
}

async function renderList() {
  const registries = await getRegistries();
  el.list.replaceChildren(...registries.map(registryRow));

  const existingEmpty = document.querySelector('.empty');
  if (existingEmpty) existingEmpty.remove();
  if (!registries.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No registries configured yet.';
    el.list.after(empty);
  }
}

// ---- editor ------------------------------------------------------------

function openEditor(registry) {
  clearResult();
  el.editor.hidden = false;
  el.editorTitle.textContent = registry ? 'Edit registry' : 'Add a registry';
  el.id.value = registry?.id ?? '';
  el.name.value = registry?.name ?? '';
  el.url.value = registry?.url ?? '';
  el.username.value = registry?.username ?? '';
  el.password.value = registry?.password ?? '';
  el.manualRepos.value = (registry?.manualRepositories ?? []).join('\n');
  el.url.focus();
}

function closeEditor() {
  el.editor.hidden = true;
  el.form.reset();
  el.id.value = '';
  clearResult();
}

async function testConnection() {
  const registry = formValues();
  if (!registry.url) {
    showResult('Enter the registry URL first.', false);
    return;
  }

  el.test.disabled = true;
  el.test.textContent = 'Testing…';
  try {
    const granted = await requestHostAccess(registry.url);
    if (!granted) {
      showResult(`Chrome needs permission to reach ${hostOf(registry.url)} before it can be tested.`, false);
      return;
    }

    const result = await chrome.runtime.sendMessage({ type: 'testConnection', registry });
    if (result?.error) {
      showResult(result.error.message, false);
      return;
    }
    if (!result.ok) {
      showResult(result.message ?? 'The registry did not accept the credentials.', false);
      return;
    }

    // Remember what the probe learned so real requests skip the challenge.
    el.form.dataset.authMode = result.authMode;
    el.form.dataset.authRealm = result.authRealm ?? '';
    el.form.dataset.authService = result.authService ?? '';
    showResult(`Connected. ${AUTH_LABELS[result.authMode]} detected.`, true);
  } finally {
    el.test.disabled = false;
    el.test.textContent = 'Test connection';
  }
}

async function save(event) {
  event.preventDefault();
  const values = formValues();
  if (!values.url) {
    showResult('Enter the registry URL first.', false);
    return;
  }

  const granted = await requestHostAccess(values.url);
  if (!granted) {
    showResult(`Chrome needs permission to reach ${hostOf(values.url)}. Grant it to save this registry.`, false);
    return;
  }

  const saved = await saveRegistry({
    ...values,
    authMode: el.form.dataset.authMode || undefined,
    authRealm: el.form.dataset.authRealm || null,
    authService: el.form.dataset.authService || null,
  });

  // A saved registry with no detected auth mode gets probed now, so the popup
  // does not open into an avoidable error.
  if (!el.form.dataset.authMode) {
    const result = await chrome.runtime.sendMessage({
      type: 'testConnection',
      registry: saved,
    });
    if (result?.ok === false) {
      await renderList();
      showResult(result.message ?? 'Saved, but the registry did not accept the credentials.', false);
      return;
    }
  }

  await chrome.runtime.sendMessage({ type: 'clearCache', registryId: saved.id });
  await renderList();
  closeEditor();
}

el.add.addEventListener('click', () => openEditor(null));
el.cancel.addEventListener('click', closeEditor);
el.test.addEventListener('click', testConnection);
el.form.addEventListener('submit', save);
// A changed URL or credential invalidates whatever the last probe detected.
for (const input of [el.url, el.username, el.password]) {
  input.addEventListener('input', () => {
    delete el.form.dataset.authMode;
    delete el.form.dataset.authRealm;
    delete el.form.dataset.authService;
  });
}

renderList().then(async () => {
  const registries = await getRegistries();
  if (!registries.length) openEditor(null);
});
