# Git Fox Tab

A Firefox extension that reads all open tabs (and tab groups) across every
window, saves them locally, and exports them to a Git repository
(GitLab or GitHub) using a token.

## Features

- **Collect tabs from all windows** — every open window is captured and tabs
  remember which window they belonged to.
- **Tab groups** — native Firefox tab groups (Firefox 141+) are saved with
  their name, color and collapsed state.
- **Containers** — Firefox Multi-Account Containers (contextual identities)
  are saved as an additional grouping mechanism.
- **Push to Git** — writes the saved tabs as a JSON file to a GitLab or
  GitHub repository using the REST API and a personal access token.
- **Manual import / export** — download a JSON file with your tabs and
  re-import it (e.g. to move data between machines).
- **Restore** — reopen the saved tabs grouped by their original window.

## Install (temporary, for development)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…** and select `manifest.json`.
3. The Git Fox Tab icon appears in the toolbar.

To install permanently, sign the extension or load it via
[Firefox Developer Edition / Nightly](https://developer.mozilla.org/Add-ons/WebExtensions/Your_first_WebExtension#Installing)
with `xpinstall.signatures.required` set to `false` in `about:config`.

## Configure

Open the extension **Settings** (gear link in the popup, or via the Add-ons
manager → Git Fox Tab → Preferences):

| Field          | GitHub                                   | GitLab                                   |
|----------------|------------------------------------------|------------------------------------------|
| Platform       | `GitHub`                                 | `GitLab`                                 |
| Server URL     | empty for github.com, or Enterprise URL  | `https://gitlab.example.com`             |
| Access token   | fine-grained PAT, `Contents: Read+write` | project token, `write_repository` scope  |
| Project path   | `owner/repo`                             | `namespace/repo`                         |
| Branch         | e.g. `main`                              | e.g. `main`                              |
| File path      | e.g. `git-fox-tab/tabs-export.json`      | e.g. `git-fox-tab/tabs-export.json`      |
| Commit message | any                                      | any                                      |

Click **Test connection** to verify the token. On **Save settings** the
extension requests host permission for the server so it can call the API.

## Usage (popup)

- **Collect & save tabs** — reads every window/tab/group and stores it locally.
- **Push to Git** — commits the stored JSON file to the configured repository.
- **Export to file** — downloads the stored data as a `.json` file.
- **Import from file** — loads a previously exported `.json` file.
- **Restore tabs** — reopens the stored tabs, one window per original window.
- **Restore selected tabs** — choose individual tabs or whole groups from Local
  or Git backups. Expand a group to view its tabs; its checkbox selects or
  deselects all tabs inside it.

## Output format

```jsonc
{
  "version": 1,
  "exportedAt": "2026-07-28T20:00:00.000Z",
  "windows": [
    {
      "id": 1, "title": "Window 1", "incognito": false, "type": "normal",
      "tabs": [
        { "id": 1, "title": "Example", "url": "https://example.com",
          "index": 0, "pinned": false, "active": true,
          "groupId": 12, "cookieStoreId": "firefox-container-1",
          "favIconUrl": "..." }
      ]
    }
  ],
  "groups": [
    { "id": 12, "name": "Research", "color": "blue", "collapsed": false, "windowId": 1 }
  ],
  "containers": [
    { "cookieStoreId": "firefox-container-1", "name": "Work", "color": "blue", "icon": "briefcase" }
  ]
}
```

## Permissions

- `tabs`, `tabGroups`, `contextualIdentities` — read tabs, groups, containers.
- `windows` — enumerate windows.
- `storage` — save data and settings locally.
- `downloads` — export a JSON file.
- `optional_host_permissions` (`*://*/*`) — requested at runtime, only for the
  Git server origin you configure.

## Files

```
manifest.json          extension manifest (MV3)
background.js          collection, git client, import/export, restore, messaging
popup/                 toolbar popup UI
options/               settings page
icons/                 generated icons
tools/make_icons.py    icon generator (Pillow)
```
