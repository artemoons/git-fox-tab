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

$('btn-export').addEventListener('click', withBusy('btn-export', async () => {
  const r = await sendMessage({ type: 'exportFile' });
  handleResponse(r, () => `Exported: ${r.result.filename}`);
}));

$('btn-restore').addEventListener('click', withBusy('btn-restore', async () => {
  const r = await sendMessage({ type: 'restore' });
  handleResponse(r, () => `Restored ${r.result.openedTabs} tabs in ${r.result.openedWindows} windows (${r.result.restoredGroups} groups).`);
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
