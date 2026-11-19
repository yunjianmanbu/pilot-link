# Pilot Link

**English** | [中文](README.zh-CN.md)

[![CI](https://github.com/yunjianmanbu/pilot-link/actions/workflows/ci.yml/badge.svg)](https://github.com/yunjianmanbu/pilot-link/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Discussions](https://img.shields.io/badge/discussions-open-2ea44f.svg)](https://github.com/yunjianmanbu/pilot/discussions)

Pilot Link is the phone side of [Pilot](https://github.com/yunjianmanbu/pilot): an Android app
(uni-app; the same sources also build for H5) that connects to Pilot running on your computer, so you
can drive the agent from your phone — read sessions, continue conversations, approve tool calls,
manage the queue and scheduled work, and preview the files a session wrote.

It is not a reskin of any chat console: the data layer implements Pilot's relay protocol and session
model directly, while the UI keeps uni-app's interaction structure.

**There is no public relay run by the Pilot project.** To reach your computer across networks, deploy
the connector yourself: <https://github.com/yunjianmanbu/pilot-connector>. On the same LAN the app can
connect directly.

## Features

- Pair with the desktop Pilot by scanning a QR code; pairing data and end-to-end keys stay on the
  phone and reconnect automatically after a restart;
- Session list, full history and workspace view, streaming text and reasoning as the run happens;
- Execution trace (reasoning / tool call / tool result) inline in the conversation, collapsed by
  default and expandable per item;
- Per-session execution mode (all auto / read-only auto / approve each call), tool approval, always
  allow, deny, pause, resume and stop;
- Queued messages and todos: edit, delete, convert to todo, send one or all; todos can be turned into
  scheduled jobs (once / interval / daily) and back;
- Send images (up to 3, compressed on the phone as data URLs) and reference other workspaces (up to 8:
  only the workspace path is sent, the desktop validates it and exposes it read-only);
- Create, rename and fork sessions; list and preview the files a session wrote;
- Pick any existing folder under the desktop's allowed roots as the workspace, or create a subfolder
  where you are browsing — the phone only submits a relative path, browsing, validation and creation
  all happen on the desktop;
- Session knowledge base: every instruction and reply paired on one page, rendered as Markdown, with
  search and jump-back to the original message; the list is cached locally so it still works when the
  desktop is offline;
- Keep several paired computers and switch between them; a paired phone can show a one-time
  hand-over QR code so a second phone connects to the same computer;
- Dark / light / follow-system themes, ten low-saturation accent colours, three contrast and
  saturation levels and three font sizes;
- In-app update check: HTTPS manifest, SHA-256 verification, install after confirmation;
- A complete offline user manual under Settings → Help.

Messages between phone and desktop are end-to-end encrypted (ECDH P-256 + HKDF-SHA256 +
AES-256-GCM); the relay only forwards ciphertext. The app needs no account of any kind.

## Protocol

The phone talks to the desktop over the connector or a direct LAN connection, protocol version 2:

1. The phone sends `relay.hello` (role `phone`); payload frames are wrapped in
   `{ type: 'relay.frame', data }`.
2. An encrypted session runs `hello` → `hello.challenge` → `hello.proof` (HMAC-SHA256) → `welcome`.
3. Business methods use Pilot's `device.info`, `sessions.*`, `chat.*`, `todos.*`, `queue.*`,
   `schedules.*`, `approval.*`, `files.*` and friends. `chat.send` may carry `images` (data URLs, at
   most 3) and `references` (workspace-relative paths, at most 8); the desktop re-checks size, count
   and paths.
4. Run events use `run.started`, `message.delta`, `reasoning.delta`, `tool.call`, `tool.result`,
   `tool.approval_required`, `run.completed`, `queue.changed`, `todos.changed` and so on.

The older `hello.legacy` handshake still works for pairings created before an upgrade.

### File preview

Pilot only previews text inside the workspace, so:

- The session "files" entry calls `files.session` to list the files that session successfully wrote
  (`write_file` / `apply_patch`);
- Opening a file calls `files.read({ workspacePath, file })`; text and Markdown render directly;
- Images (≤ 12 MB) and text preview in place; video, audio, Office and PDF files are downloaded in
  chunks to the app's private directory (`_doc/pilot-files/`) and handed to a system app, 100 MB per
  file;
- The desktop validates every path against the workspace realpath, so the phone cannot read anything
  outside it.

### Download cache

Files you opened stay on the phone for a few days (`lib/file-cache.js`):

- The first open downloads the file and records the last-viewed time in `pilot-app.file-cache.v1`;
- The retention period defaults to 7 days and is configurable under **Settings → Features → File
  cache** (1 / 3 / 7 / 14 / 30 / 90 days, stored in `pilot-app.file-cache-days.v1`, clamped to 1–365);
- Reopening within the period uses the local file (no relay traffic) and restarts the timer;
- Expired entries are swept on launch (`onLaunch` in `App.vue`) and before every open; lowering the
  period sweeps immediately;
- The index key is "workspace + path inside the workspace" and the on-disk name carries a path hash,
  so same-named files in different directories do not collide;
- A missing local file, or a changed size on the desktop, counts as a miss and re-downloads; the
  in-page "download again" button forces a refresh.

## Layout

```text
App.vue                 app entry, theme variables
main.js                 Vue 3 entry
manifest.json           uni-app config (app id, package name, icons, permissions)
pages.json              page routes
index.html              H5 template
lib/
  bytes.js              base64url / UTF-8 / randomness
  e2e.js                end-to-end crypto compatible with pilot/client src/main/companion/crypto.ts
  pairing.js            pairing payload parsing
  storage.js            multiple computers, theme, per-device caches
  client.js             WebSocket connector client (heartbeat, reconnect, sequence, encryption)
  files.js              file type detection, chunked read, local persistence
  file-cache.js         download cache: expiry, renewal, launch sweep
  clipboard.js          copy and select-copy
  format.js             time, tool-call summaries, execution-mode labels
  manual-content.js     generated user-manual body
store/index.js          global state, method calls and live event handling
pages/                  launch / pair / sessions / chat / knowledge / files / file / select /
                        settings / update / feedback / manual
scripts/gen-icons.mjs   generates Android icons and 9-patch splash images (pure Node)
static/                 icons and splash assets
test/                   unit tests (crypto compatibility, storage, update, Markdown, ...)
```

## Development

Node 22+.

```bash
npm install
npm test
```

To run the web build, open the project in HBuilderX and use *Run → Run to browser*; the build output
lands in `unpackage/dist/build/web/`. `index.html` must keep
`<script type="module" src="/main.js"></script>`.

Regenerate icons:

```bash
node scripts/gen-icons.mjs
```

## Packaging for Android

Two routes, both documented in detail by uni-app: **cloud packaging** in HBuilderX (needs an account
and the app's certificate) or **offline packaging** with the Android SDK and this repository's native
shell under `native/`. Offline packaging needs the Gradle project, the offline SDK and
`zip4j` (without it the APK installs but in-app hot updates fail).

Every release:

1. Bump `versionName` / `versionCode` in `manifest.json`;
2. Build the APK and compute its SHA-256;
3. Publish the APK plus a `latest.json` manifest (size + sha256) over HTTPS;
4. Update the download page.

### Hot updates (wgt)

Small changes to `pages/`, `lib/`, `App.vue` that do not touch native modules, permissions, icons or
the SDK can ship as a uni-app resource package instead of a full APK:

- The wgt version must be greater than the shell's `versionName`;
- After installing a wgt, `plus.runtime.version` reports the resource version; the app keeps a local
  record (`pilot-app.update-wgt.v1`) so the same update is not offered twice;
- The client treats the `wgt` field as optional: a missing or wrong-hosted resource simply falls back
  to the full update;
- A shell that has never shipped wgt support must be replaced by a full APK first.

## Security

Report vulnerabilities privately — see [SECURITY.md](SECURITY.md). Messages are end-to-end encrypted;
the connector never sees plaintext, session content or keys.

## License

[Apache License 2.0](LICENSE), copyright 2026 rigongyizu. Keep the copyright notice and the
[`NOTICE`](NOTICE) file, and state the changes in files you modified.

Third-party components (@noble, uni-app, ...) are listed in [`NOTICE`](NOTICE).
