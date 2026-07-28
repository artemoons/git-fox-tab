const $ = (id) => document.getElementById(id);
const KEYS = ['gitPlatform', 'serverUrl', 'token', 'projectPath', 'branch', 'filePath', 'commitMessage'];

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

function readForm() {
  const settings = {};
  for (const k of KEYS) settings[k] = $(k).value.trim();
  return settings;
}

function fillForm(settings) {
  for (const k of KEYS) {
    $(k).value = settings[k] != null ? settings[k] : '';
  }
}

async function load() {
  const res = await sendMessage({ type: 'getSettings' });
  if (res.ok) fillForm(res.result);
}

function originFrom(url) {
  try {
    return new URL(url).origin + '/*';
  } catch (e) {
    return null;
  }
}

// The origin the background will actually fetch (the REST API origin).
function apiOriginFor(settings) {
  const server = (settings.serverUrl || '').trim().replace(/\/+$/, '');
  if (settings.gitPlatform === 'github') {
    if (!server || /^https?:\/\/github\.com$/i.test(server)) {
      return 'https://api.github.com';
    }
    return server; // Enterprise: API is at <server>/api/v3 (same origin)
  }
  return server || 'https://gitlab.com'; // GitLab: API is at <server>/api/v4 (same origin)
}

// Must be the FIRST awaited call in a user gesture: permissions.request()
// requires an active user input handler, and any prior `await` of an async
// API (e.g. sendMessage, permissions.contains) voids the gesture in Firefox.
// If the origin is already granted, request() resolves to true with no prompt.
async function ensureHostPermission(settings) {
  const origin = originFrom(apiOriginFor(settings));
  if (!origin) throw new Error('Invalid server URL.');
  return browser.permissions.request({ origins: [origin] });
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearMessage();
  const settings = readForm();
  if (!settings.token) return showMessage('Token is required.', 'err');
  if (!settings.projectPath) return showMessage('Project path is required.', 'err');

  // Request host permission for the API origin (must happen in a user gesture).
  try {
    const ok = await ensureHostPermission(settings);
    if (!ok) return showMessage('Host permission denied. Push to Git will not work.', 'err');
  } catch (err) {
    return showMessage('Host permission error: ' + err.message, 'err');
  }

  const res = await sendMessage({ type: 'saveSettings', settings });
  if (res.ok) showMessage('Settings saved.', 'ok');
  else showMessage(res.error, 'err');
});

$('btn-test').addEventListener('click', async () => {
  clearMessage();
  const btn = $('btn-test');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Testing…';
  try {
    const settings = readForm();
    // Request host permission FIRST (must be in the user gesture, before any
    // awaited sendMessage, otherwise Firefox rejects permissions.request()).
    try {
      const ok = await ensureHostPermission(settings);
      if (!ok) return showMessage('Host permission denied. Push to Git will not work.', 'err');
    } catch (err) {
      return showMessage('Host permission error: ' + err.message, 'err');
    }
    await sendMessage({ type: 'saveSettings', settings });
    const res = await sendMessage({ type: 'testConnection', settings });
    if (res.ok) {
      const u = res.result;
      showMessage(`Connected as ${u.login || u.name || 'user'}.`, 'ok');
    } else {
      showMessage(res.error, 'err');
    }
  } catch (err) {
    showMessage(err.message || String(err), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

load();
