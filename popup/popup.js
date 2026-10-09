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
let rsExpanded = { local: new Set(), git: new Set() };
let rsSelectableKeys = [];

function countRawTabs(data) {
  if (!data || !Array.isArray(data.windows)) return 0;
  return data.windows.reduce((n, w) => n + ((w.tabs || []).length), 0);
}

async function openRestoreSelected() {
  showScreen('restore-selected');
  clearMessage();

  rsSelected = { local: new Set(), git: new Set() };
  rsExpanded = { local: new Set(), git: new Set() };
  rsCache = { local: null, git: null, gitError: null };

  $('rs-tab-local').disabled = true;
  $('rs-tab-git').disabled = true;
  $('rs-restore-btn').disabled = true;
  $('rs-select-all-btn').disabled = true;
  $('rs-select-all-btn').textContent = 'Select all';
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

  rsSelectableKeys = windowRows.flatMap(({ validRows }) => validRows.map(({ key }) => key));
  $('rs-select-all-btn').disabled = rsSelectableKeys.length === 0;
  $('rs-select-all-btn').textContent = 'Select all';

  if (!windowRows.length) {
    $('rs-empty').hidden = false;
    $('rs-empty').textContent = (rsSource === 'git' && rsCache.gitError)
      ? rsCache.gitError
      : 'Backup is empty.';
    $('rs-restore-btn').disabled = true;
    return;
  }
  $('rs-empty').hidden = true;

  const selected = rsSelected[rsSource];
  const expanded = rsExpanded[rsSource];
  const groupInfo = new Map((data.groups || []).map(g => [g.id, g]));
  const updateSelectionButtons = () => {
    $('rs-restore-btn').disabled = selected.size === 0;
    $('rs-select-all-btn').textContent = rsSelectableKeys.every(key => selected.has(key))
      ? 'Deselect all' : 'Select all';
  };

  windowRows.forEach(({ win, wi, validRows }) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'rs-window-group';

    const label = document.createElement('div');
    label.className = 'rs-window-label';
    label.textContent = win.title || `Window ${wi + 1}`;
    groupEl.appendChild(label);

    const windowList = document.createElement('ul');
    windowList.className = 'rs-window-tabs';
    groupEl.appendChild(windowList);

    const groupedRows = new Map();
    validRows.forEach(row => {
      if (row.t.groupId == null || row.t.groupId < 0) return;
      if (!groupedRows.has(row.t.groupId)) groupedRows.set(row.t.groupId, []);
      groupedRows.get(row.t.groupId).push(row);
    });

    function appendTab(parent, { t, key }, updateGroup = () => {}) {
      const item = document.createElement('li');
      const row = document.createElement('label');
      row.className = 'rs-tab-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.has(key);
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(key);
        else selected.delete(key);
        updateGroup();
        updateSelectionButtons();
      });

      const span = document.createElement('span');
      span.className = 'rs-tab-title';
      span.textContent = t.title || t.url;
      span.title = t.url;

      row.appendChild(cb);
      row.appendChild(span);
      item.appendChild(row);
      parent.appendChild(item);
      return cb;
    }

    const renderedGroups = new Set();
    validRows.forEach(tabRow => {
      const groupId = tabRow.t.groupId;
      if (!groupedRows.has(groupId)) {
        appendTab(windowList, tabRow);
        return;
      }
      if (renderedGroups.has(groupId)) return;
      renderedGroups.add(groupId);

      const rows = groupedRows.get(groupId);
      const info = groupInfo.get(groupId);
      const groupName = (info && info.name) || `Group ${groupId}`;
      const groupKey = `${wi}:${groupId}`;
      const item = document.createElement('li');
      item.className = 'rs-tab-group';

      const header = document.createElement('div');
      header.className = 'rs-group-header';
      const groupCheckbox = document.createElement('input');
      groupCheckbox.type = 'checkbox';
      groupCheckbox.setAttribute('aria-label', `Select all tabs in ${groupName}`);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'rs-group-toggle';
      const arrow = document.createElement('span');
      arrow.className = 'rs-group-arrow';
      arrow.textContent = '▸';
      arrow.setAttribute('aria-hidden', 'true');
      const title = document.createElement('span');
      title.className = 'rs-tab-title';
      title.textContent = groupName;
      title.title = groupName;
      const count = document.createElement('span');
      count.className = 'rs-group-count';
      count.textContent = rows.length;
      toggle.append(arrow, title, count);
      header.append(groupCheckbox, toggle);

      const children = document.createElement('ul');
      children.className = 'rs-group-tabs';
      children.id = `rs-group-${rsSource}-${wi}-${groupId}`;
      toggle.setAttribute('aria-controls', children.id);
      const updateExpanded = () => {
        const isExpanded = expanded.has(groupKey);
        children.hidden = !isExpanded;
        toggle.setAttribute('aria-expanded', String(isExpanded));
      };
      toggle.addEventListener('click', () => {
        if (expanded.has(groupKey)) expanded.delete(groupKey);
        else expanded.add(groupKey);
        updateExpanded();
      });
      updateExpanded();

      const updateGroup = () => {
        const selectedCount = rows.filter(({ key }) => selected.has(key)).length;
        groupCheckbox.checked = selectedCount === rows.length;
        groupCheckbox.indeterminate = selectedCount > 0 && selectedCount < rows.length;
      };
      const tabCheckboxes = rows.map(row => appendTab(children, row, updateGroup));
      groupCheckbox.addEventListener('change', () => {
        rows.forEach(({ key }, index) => {
          if (groupCheckbox.checked) selected.add(key);
          else selected.delete(key);
          tabCheckboxes[index].checked = groupCheckbox.checked;
        });
        updateGroup();
        updateSelectionButtons();
      });
      updateGroup();
      item.append(header, children);
      windowList.appendChild(item);
    });

    list.appendChild(groupEl);
  });

  updateSelectionButtons();
}

$('rs-select-all-btn').addEventListener('click', () => {
  const selected = rsSelected[rsSource];
  if (rsSelectableKeys.every(key => selected.has(key))) selected.clear();
  else rsSelectableKeys.forEach(key => selected.add(key));
  renderRsSource();
});

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
