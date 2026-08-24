const $ = (id) => document.getElementById(id);

function sendMessage(message) {
  return browser.runtime.sendMessage(message);
}

function showMessage(text, kind) {
  const el = $('message');
  el.hidden = false;
  el.className = 'message ' + (kind || 'info');
  el.textContent = text;
}

function clearMessage() {
  $('message').hidden = true;
}

async function refreshStatus() {
  const res = await sendMessage({ type: 'getStatus' });
  if (!res.ok || !res.result) {
    $('stat-windows').textContent = '—';
    $('stat-tabs').textContent = '—';
    $('stat-groups').textContent = '—';
    $('stat-containers').textContent = '—';
    $('stat-saved').textContent = 'never';
    return;
  }
  const s = res.result;
  $('stat-windows').textContent = s.windowCount ?? '—';
  $('stat-tabs').textContent = s.tabCount ?? '—';
  $('stat-groups').textContent = s.groupCount ?? '—';
  $('stat-containers').textContent = s.containerCount ?? '—';
  $('stat-saved').textContent = s.exportedAt
    ? new Date(s.exportedAt).toLocaleString()
    : 'never';
}

function withBusy(btn, fn) {
  return async () => {
    clearMessage();
    const buttons = document.querySelectorAll('.btn');
    buttons.forEach(b => b.disabled = true);
    try {
      await fn();
    } catch (e) {
      showMessage(e.message || String(e), 'err');
    } finally {
      buttons.forEach(b => b.disabled = false);
      refreshStatus();
    }
  };
}

function handleResponse(res, okTextFn) {
  if (!res.ok) throw new Error(res.error || 'Operation failed');
  const text = typeof okTextFn === 'function' ? okTextFn() : okTextFn;
  if (text) showMessage(text, 'ok');
  return res.result;
}

$('btn-collect').addEventListener('click', withBusy('btn-collect', async () => {
  const r = await sendMessage({ type: 'collect' });
  handleResponse(r, () => `Saved ${r.result.tabCount} tabs in ${r.result.windowCount} windows.`);
}));

$('btn-push').addEventListener('click', withBusy('btn-push', async () => {
  const r = await sendMessage({ type: 'pushGit' });
  handleResponse(r, () => `Pushed to ${r.result.platform}: ${r.result.project} (${r.result.branch}). ${r.result.updated ? 'Updated' : 'Created'}.`);
}));

$('btn-pull').addEventListener('click', withBusy('btn-pull', async () => {
  const r = await sendMessage({ type: 'pullGit' });
  handleResponse(r, () => `Pulled ${r.result.tabCount} tabs in ${r.result.windowCount} windows from Git.`);
}));

$('btn-export').addEventListener('click', withBusy('btn-export', async () => {
  const r = await sendMessage({ type: 'exportFile' });
  handleResponse(r, () => `Exported: ${r.result.filename}`);
}));

$('btn-restore').addEventListener('click', withBusy('btn-restore', async () => {
  const r = await sendMessage({ type: 'restore' });
  handleResponse(r, () => `Restored ${r.result.openedTabs} tabs in ${r.result.openedWindows} windows (${r.result.restoredGroups} groups).`);
}));

/* ---------- restore selected tabs screen ---------- */

function showScreen(name) {
  $('screen-main').hidden = name !== 'main';
  $('screen-restore-selected').hidden = name !== 'restore-selected';
}

let rsSource = 'local';
let rsCache = { local: null, git: null, gitError: null };
let rsSelected = { local: new Set(), git: new Set() };

function countRawTabs(data) {
  if (!data || !Array.isArray(data.windows)) return 0;
  return data.windows.reduce((n, w) => n + ((w.tabs || []).length), 0);
}

async function openRestoreSelected() {
  showScreen('restore-selected');
  clearMessage();

  rsSelected = { local: new Set(), git: new Set() };
  rsCache = { local: null, git: null, gitError: null };

  $('rs-tab-local').disabled = true;
  $('rs-tab-git').disabled = true;
  $('rs-restore-btn').disabled = true;
  $('rs-empty').hidden = true;
  $('rs-list').innerHTML = '<div class="rs-loading">Loading…</div>';

  const [localRes, gitRes] = await Promise.all([
    sendMessage({ type: 'getLocalTabsData' }),
    sendMessage({ type: 'getGitTabsData' })
  ]);

  rsCache.local = (localRes.ok && localRes.result) ? localRes.result : null;
  if (gitRes.ok) {
    rsCache.git = gitRes.result || null;
  } else {
    rsCache.git = null;
    rsCache.gitError = gitRes.error || 'Failed to load Git backup.';
  }

  const localHas = countRawTabs(rsCache.local) > 0;
  const gitHas = countRawTabs(rsCache.git) > 0;

  const toggleActive = localHas || gitHas;
  $('rs-tab-local').disabled = !toggleActive;
  $('rs-tab-git').disabled = !toggleActive;
  rsSource = localHas ? 'local' : (gitHas ? 'git' : 'local');

  renderRsSource();
}

function renderRsSource() {
  $('rs-tab-local').classList.toggle('active', rsSource === 'local');
  $('rs-tab-git').classList.toggle('active', rsSource === 'git');

  const data = rsCache[rsSource];
  const list = $('rs-list');
  list.innerHTML = '';

  const windowRows = [];
  if (data && Array.isArray(data.windows)) {
    data.windows.forEach((win, wi) => {
      const rawTabs = win.tabs || [];
      const validRows = [];
      rawTabs.forEach((t, ti) => {
        if (!t.url || /^(about|chrome|moz-extension):/i.test(t.url)) return;
        validRows.push({ t, key: `${wi}:${ti}` });
      });
      if (validRows.length) windowRows.push({ win, wi, validRows });
    });
  }

  if (!windowRows.length) {
    $('rs-empty').hidden = false;
    $('rs-empty').textContent = (rsSource === 'git' && rsCache.gitError)
      ? rsCache.gitError
      : 'Backup is empty.';
    $('rs-restore-btn').disabled = true;
    return;
  }
  $('rs-empty').hidden = true;

  windowRows.forEach(({ win, wi, validRows }) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'rs-window-group';

    const label = document.createElement('div');
    label.className = 'rs-window-label';
    label.textContent = win.title || `Window ${wi + 1}`;
    groupEl.appendChild(label);

    validRows.forEach(({ t, key }) => {
      const row = document.createElement('label');
      row.className = 'rs-tab-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = rsSelected[rsSource].has(key);
      cb.addEventListener('change', () => {
        if (cb.checked) rsSelected[rsSource].add(key);
        else rsSelected[rsSource].delete(key);
        $('rs-restore-btn').disabled = rsSelected[rsSource].size === 0;
      });

      const span = document.createElement('span');
      span.className = 'rs-tab-title';
      span.textContent = t.title || t.url;
      span.title = t.url;

      row.appendChild(cb);
      row.appendChild(span);
      groupEl.appendChild(row);
    });

    list.appendChild(groupEl);
  });

  $('rs-restore-btn').disabled = rsSelected[rsSource].size === 0;
}

$('btn-restore-selected').addEventListener('click', () => {
  openRestoreSelected();
});

$('rs-back').addEventListener('click', () => {
  showScreen('main');
  clearMessage();
  refreshStatus();
});

$('rs-tab-local').addEventListener('click', () => {
  if (rsSource === 'local') return;
  rsSource = 'local';
  renderRsSource();
});

$('rs-tab-git').addEventListener('click', () => {
  if (rsSource === 'git') return;
  rsSource = 'git';
  renderRsSource();
});

$('rs-restore-btn').addEventListener('click', withBusy('rs-restore-btn', async () => {
  const selected = Array.from(rsSelected[rsSource]);
  const r = await sendMessage({ type: 'restoreSelected', source: rsSource, selected });
  handleResponse(r, () => `Restored ${r.result.openedTabs} tabs in ${r.result.openedWindows} windows (${r.result.restoredGroups} groups).`);
  showScreen('main');
}));

$('btn-import').addEventListener('click', () => $('file-input').click());

$('file-input').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  clearMessage();
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const r = await sendMessage({ type: 'importData', data });
    handleResponse(r, `Imported ${r.result.tabCount} tabs in ${r.result.windowCount} windows.`);
  } catch (err) {
    showMessage(err.message || String(err), 'err');
  } finally {
    refreshStatus();
  }
});

$('open-options').addEventListener('click', (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});

refreshStatus();
