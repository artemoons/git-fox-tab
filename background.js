/* Git Fox Tab - background script (event page)
 * Handles: tab collection across windows (with groups + containers),
 * local storage, git push (GitHub/GitLab), file import/export, restore.
 */

const STORAGE_KEYS = {
  settings: 'settings',
  tabsData: 'tabsData',
  status: 'status'
};

const DEFAULT_SETTINGS = {
  gitPlatform: 'gitlab',
  serverUrl: '',
  token: '',
  projectPath: '',
  branch: 'main',
  filePath: 'git-fox-tab/tabs-export.json',
  commitMessage: 'chore: update tabs export'
};

/* ---------- storage helpers ---------- */

async function getSettings() {
  const res = await browser.storage.local.get(STORAGE_KEYS.settings);
  return Object.assign({}, DEFAULT_SETTINGS, res[STORAGE_KEYS.settings] || {});
}

async function saveSettings(settings) {
  await browser.storage.local.set({ [STORAGE_KEYS.settings]: settings });
}

async function getTabsData() {
  const res = await browser.storage.local.get(STORAGE_KEYS.tabsData);
  return res[STORAGE_KEYS.tabsData] || null;
}

async function saveTabsData(data) {
  await browser.storage.local.set({ [STORAGE_KEYS.tabsData]: data });
  const status = {
    exportedAt: data.exportedAt,
    windowCount: data.windows.length,
    tabCount: data.windows.reduce((n, w) => n + w.tabs.length, 0),
    groupCount: (data.groups || []).length,
    containerCount: (data.containers || []).length
  };
  await browser.storage.local.set({ [STORAGE_KEYS.status]: status });
  return status;
}

async function getStatus() {
  const res = await browser.storage.local.get(STORAGE_KEYS.status);
  return res[STORAGE_KEYS.status] || null;
}

/* ---------- base64 helpers (UTF-8 safe) ---------- */

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const clean = String(b64 || '').replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ---------- tab collection ---------- */

async function collectTabs() {
  const [tabs, windows] = await Promise.all([
    browser.tabs.query({}),
    browser.windows.getAll({})
  ]);

  const windowsData = windows.map(w => ({
    id: w.id,
    title: w.title || `Window ${w.id}`,
    incognito: !!w.incognito,
    type: w.type || 'normal',
    state: w.state || null,
    tabs: []
  }));
  const winMap = new Map(windowsData.map(w => [w.id, w]));

  const sorted = tabs.slice().sort(
    (a, b) => (a.windowId - b.windowId) || (a.index - b.index)
  );

  for (const tab of sorted) {
    const win = winMap.get(tab.windowId);
    if (!win) continue;
    win.tabs.push({
      id: tab.id,
      title: tab.title || tab.url || '',
      url: tab.url,
      index: tab.index,
      pinned: !!tab.pinned,
      active: !!tab.active,
      groupId: (typeof tab.groupId === 'number') ? tab.groupId : null,
      cookieStoreId: tab.cookieStoreId || null,
      favIconUrl: tab.favIconUrl || null
    });
  }

  // Tab groups (Firefox 141+). Guarded so older versions still work.
  let groups = [];
  if (browser.tabGroups && typeof browser.tabGroups.query === 'function') {
    try {
      for (const w of windows) {
        const gs = await browser.tabGroups.query({ windowId: w.id });
        for (const g of gs) {
          groups.push({
            id: g.id,
            name: g.name || '',
            color: g.color || null,
            collapsed: !!g.collapsed,
            windowId: g.windowId
          });
        }
      }
    } catch (e) {
      console.warn('tabGroups query failed:', e);
    }
  }

  // Containers (contextual identities) - a Firefox grouping mechanism.
  let containers = [];
  if (browser.contextualIdentities && typeof browser.contextualIdentities.query === 'function') {
    try {
      const cs = await browser.contextualIdentities.query({});
      containers = cs.map(c => ({
        cookieStoreId: c.cookieStoreId,
        name: c.name,
        color: c.color,
        icon: c.icon
      }));
    } catch (e) {
      console.warn('contextualIdentities query failed:', e);
    }
  }

  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    windows: windowsData,
    groups,
    containers
  };

  await saveTabsData(data);
  return data;
}

/* ---------- git client ---------- */

function normalizeServer(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function apiBaseFor(settings) {
  const server = normalizeServer(settings.serverUrl);
  if (settings.gitPlatform === 'github') {
    if (!server || /^https?:\/\/github\.com$/i.test(server)) {
      return 'https://api.github.com';
    }
    return `${server}/api/v3`;
  }
  // gitlab
  if (!server) return 'https://gitlab.com/api/v4';
  return `${server}/api/v4`;
}

function authHeaders(settings) {
  if (settings.gitPlatform === 'github') {
    return { Authorization: `Bearer ${settings.token}`, Accept: 'application/vnd.github+json' };
  }
  return { 'PRIVATE-TOKEN': settings.token };
}

function fileUrlPath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

// GitHub: /repos/{owner}/{repo}/... — slashes must stay literal.
// GitLab: /projects/:id — :id accepts the URL-encoded full path (owner%2Frepo).
function projectPathForUrl(settings) {
  if (settings.gitPlatform === 'github') {
    return settings.projectPath.split('/').map(encodeURIComponent).join('/');
  }
  return encodeURIComponent(settings.projectPath);
}

async function gitGetFile(settings) {
  const apiBase = apiBaseFor(settings);
  const filePart = fileUrlPath(settings.filePath);
  const ref = encodeURIComponent(settings.branch);

  if (settings.gitPlatform === 'github') {
    const url = `${apiBase}/repos/${projectPathForUrl(settings)}/contents/${filePart}?ref=${ref}`;
    const res = await fetch(url, { headers: authHeaders(settings) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub GET ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { sha: data.sha || null, content: data.content || '' };
  }

  const url = `${apiBase}/projects/${projectPathForUrl(settings)}/repository/files/${filePart}?ref=${ref}`;
  const res = await fetch(url, { headers: authHeaders(settings) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitLab GET ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { sha: data.blob_id || null, content: data.content || '' };
}

async function gitPutFile(settings, contentBase64, existingSha) {
  const apiBase = apiBaseFor(settings);
  const filePart = fileUrlPath(settings.filePath);
  const message = settings.commitMessage || 'chore: update tabs export';

  if (settings.gitPlatform === 'github') {
    const url = `${apiBase}/repos/${projectPathForUrl(settings)}/contents/${filePart}`;
    const body = { message, content: contentBase64, branch: settings.branch };
    if (existingSha) body.sha = existingSha;
    const res = await fetch(url, {
      method: 'PUT',
      headers: Object.assign({}, authHeaders(settings), { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`GitHub PUT ${res.status}: ${await res.text()}`);
    return res.json();
  }

  const url = `${apiBase}/projects/${projectPathForUrl(settings)}/repository/files/${filePart}`;
  const body = {
    branch: settings.branch,
    content: contentBase64,
    commit_message: message
  };
  const res = await fetch(url, {
    method: 'PUT',
    headers: Object.assign({}, authHeaders(settings), { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`GitLab PUT ${res.status}: ${await res.text()}`);
  return res.json();
}

async function gitTestConnection(settings) {
  const apiBase = apiBaseFor(settings);
  const url = `${apiBase}/user`;
  const res = await fetch(url, { headers: authHeaders(settings) });
  if (res.status === 401 || res.status === 403) {
    throw new Error('Authentication failed: check your token.');
  }
  if (!res.ok) throw new Error(`Connection failed ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return settings.gitPlatform === 'github'
    ? { login: data.login, name: data.name }
    : { login: data.username, name: data.name };
}

async function pushToGit() {
  const settings = await getSettings();
  const errors = validateSettings(settings);
  if (errors.length) throw new Error('Settings incomplete: ' + errors.join('; '));

  const data = await getTabsData();
  if (!data) throw new Error('No saved tabs. Collect tabs first.');

  const json = JSON.stringify(data, null, 2);
  const contentBase64 = utf8ToBase64(json);

  let existing = null;
  try {
    existing = await gitGetFile(settings);
  } catch (e) {
    // If we can't read (e.g. branch missing), try to create anyway.
    console.warn('gitGetFile error (will attempt create):', e.message);
  }

  const result = await gitPutFile(settings, contentBase64, existing ? existing.sha : null);
  return {
    ok: true,
    platform: settings.gitPlatform,
    project: settings.projectPath,
    branch: settings.branch,
    path: settings.filePath,
    sha: (result.content && result.content.sha) || result.blob_id || (result.commit && result.commit.id) || null,
    updated: !!existing
  };
}

function validateSettings(s) {
  const errors = [];
  if (!s.gitPlatform) errors.push('platform');
  if (!s.serverUrl && s.gitPlatform === 'gitlab') errors.push('server URL');
  if (!s.token) errors.push('token');
  if (!s.projectPath) errors.push('project path');
  if (!s.branch) errors.push('branch');
  if (!s.filePath) errors.push('file path');
  return errors;
}

/* ---------- import / export ---------- */

async function exportToFile() {
  const data = await getTabsData();
  if (!data) throw new Error('No saved tabs to export. Collect tabs first.');
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `git-fox-tab-${ts}.json`;
  await browser.downloads.download({ url, filename, saveAs: true });
  return { filename };
}

async function importFromData(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid file: not a JSON object.');
  if (!Array.isArray(data.windows)) throw new Error('Invalid file: missing "windows" array.');
  const normalized = {
    version: data.version || 1,
    exportedAt: data.exportedAt || new Date().toISOString(),
    windows: data.windows,
    groups: Array.isArray(data.groups) ? data.groups : [],
    containers: Array.isArray(data.containers) ? data.containers : []
  };
  await saveTabsData(normalized);
  return {
    windowCount: normalized.windows.length,
    tabCount: normalized.windows.reduce((n, w) => n + (w.tabs || []).length, 0)
  };
}

/* ---------- restore ---------- */

async function restoreTabs() {
  const data = await getTabsData();
  if (!data) throw new Error('No saved tabs to restore.');
  let openedWindows = 0;
  let openedTabs = 0;

  for (const win of data.windows) {
    const tabs = (win.tabs || []).filter(t => t.url && !/^(about|chrome|moz-extension):/i.test(t.url));
    if (!tabs.length) continue;
    const urls = tabs.map(t => t.url);
    const newWin = await browser.windows.create({ url: urls.slice(0, 1) });
    openedWindows++;
    openedTabs++;

    // Create remaining tabs in the new window, preserving order/pinned.
    const newTabs = await browser.tabs.query({ windowId: newWin.id });
    if (newTabs[0] && tabs[0] && tabs[0].pinned) {
      try { await browser.tabs.update(newTabs[0].id, { pinned: true }); } catch (e) {}
    }
    for (let i = 1; i < tabs.length; i++) {
      try {
        await browser.tabs.create({
          windowId: newWin.id,
          url: tabs[i].url,
          pinned: !!tabs[i].pinned
        });
        openedTabs++;
      } catch (e) {
        console.warn('Failed to create tab:', tabs[i].url, e);
      }
    }
  }

  return { openedWindows, openedTabs };
}

/* ---------- message router ---------- */

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Return a promise so async handlers work in Firefox.
  handle(message).then(
    result => sendResponse({ ok: true, result }),
    error => sendResponse({ ok: false, error: error && error.message ? error.message : String(error) })
  );
  return true; // keep channel open for async response
});

async function handle(message) {
  switch (message && message.type) {
    case 'collect': {
      const data = await collectTabs();
      return {
        exportedAt: data.exportedAt,
        windowCount: data.windows.length,
        tabCount: data.windows.reduce((n, w) => n + w.tabs.length, 0),
        groupCount: (data.groups || []).length,
        containerCount: (data.containers || []).length
      };
    }
    case 'pushGit':
      return pushToGit();
    case 'exportFile':
      return exportToFile();
    case 'importData':
      return importFromData(message.data);
    case 'restore':
      return restoreTabs();
    case 'getStatus':
      return getStatus();
    case 'getSettings':
      return getSettings();
    case 'testConnection': {
      const settings = await getSettings();
      // allow inline overrides from the options form (unsaved values)
      const merged = Object.assign({}, settings, message.settings || {});
      return gitTestConnection(merged);
    }
    case 'saveSettings': {
      const current = await getSettings();
      const merged = Object.assign({}, current, message.settings || {});
      await saveSettings(merged);
      return merged;
    }
    default:
      throw new Error('Unknown message type: ' + (message && message.type));
  }
}
