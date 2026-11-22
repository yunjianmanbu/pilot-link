# Changelog

Every published version of Pilot Link, the phone side of Pilot. The version here is the resource
bundle version; the Android shell version it needs is written in each entry. Older history is in the
release history on the website (<https://pilot.medpilot.cc/>) and on the
[Releases page](https://github.com/yunjianmanbu/pilot-link/releases).

This file is maintained by hand: add a new entry at the top when a version ships. A release whose
notes exist only on the website is not a release anyone can find later.

Chinese version: [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md)

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/).

## [1.1.7] - 2026-11-22

Resource bundle 1.1.7 (shell 1.0.87 / versionCode 139). The silent update check now runs at most every 30 minutes instead of every 6 hours (15 minutes after a check that found an uninstalled update). During the 1.1.4 → 1.1.6 chain the phone had just confirmed "already up to date" at 23:35, so a repaired bundle published five minutes later could not be seen until the next morning. The manifest is about 1.2KB, so a 30-minute window costs nothing. Features are identical to 1.1.6.

## [1.1.6] - 2026-11-21

Resource bundle 1.1.6 (shell 1.0.87 / versionCode 139). Fixes the update check that kept this release from reaching phones. After 1.1.4 the updater recorded a check timestamp **before** asking the server and then suppressed all silent checks for 6 hours, so a repaired bundle published a few minutes later was invisible to the phone: restarting the app did not help. Now the timestamp is written only after a successful check, a failed request does not arm the throttle at all, and a check that found an uninstalled update is throttled for 1 hour instead of 6 — a fix published right after a bad build arrives on the phone by itself. Nothing else changed; features are the same as 1.1.5.

## [1.1.5] - 2026-11-21

Resource bundle 1.1.5 (shell 1.0.87 / versionCode 139). 1.1.4 shipped with two real code defects, not a packaging accident: `isWebLink` still called `new URL()` (the App logic layer is V8 / JSCore and has no `URL` global, so every link was rejected with "Only web links can be opened"), and the links / memory pages were still gated behind `v-if="ready"` with no cache fallback (a blank page whenever `onLoad` threw or the PC was offline). This version replaced that parsing with a regex + `hostOf`, removed the `ready` gate, added the phone-side `session-memory-cache` and link extraction from cached session text, and split the five session resources into their own pages. The bundle was then verified by unpacking it and asserting those symbols are present.

## [1.1.4] - 2026-11-21

Resource bundle 1.1.4 (shell 1.0.87 / versionCode 139). URLs in a session body are now tappable:
links in your own messages and in system notices render as their own tappable text, opening the
in-app preview and falling back to the system browser only when that preview is unavailable, with a
long press offering preview / open in browser / copy. Link detection no longer depends on the `URL`
global, which the app logic layer does not have and which used to drop every link, and Chinese text
butted up against a URL no longer swallows the trailing sentence into the link. The file, knowledge,
links, tools and memory shortcuts on a session row got a background that matches the card instead of
blending into it, and the links and memory pages are no longer blank: links fall back to being
extracted from the session text cached on the phone when the desktop is offline, and the memory page
lists the whole project memory with an explanation when a task has not used memory yet.

## [1.1.3] - 2026-11-21

Resource bundle 1.1.3 (shell 1.0.87 / versionCode 139). Each of the five shortcuts on a session row
now opens its own page, so files, knowledge, links, tools and memory no longer share one tabbed
resource page; links preview inside the app WebView with a title bar and back button; and all five
chips share one style, so memory is no longer the only one in the accent colour.

## [1.1.2] - 2026-11-21

Resource bundle 1.1.2 (shell 1.0.87 / versionCode 139). The session resources page gained a memory
category listing what a task has written to memory.

## [1.1.1] - 2026-11-21

Resource bundle 1.1.1 (shell 1.0.87). Session cards gain "Links" and "Tools" next to "Files" and
"Knowledge"; both open the session resources view. Links can be copied or handed to the system
browser, and every tool carries its source (built-in / MCP / authored), its risk (read-only / writes
files / runs commands / takes control) and whether it is enabled. When the desktop is offline, links
are extracted from the session text cached on the phone, and the tools list says a connection is
needed instead of showing an empty list. From desktop 0.1.83 on, the desktop gathers both entries
itself. Everything else matches 1.1.0.

## [1.1.0] - 2026-11-20

Resource bundle 1.1.0 (shell 1.0.87 / versionCode 139). Scheduled-task cards give their content a
full row and put the time below the buttons.

## [1.0.99] - 2026-11-19

Resource bundle 1.0.99 (shell 1.0.87 / versionCode 139).

- The running, queued, paused and unread badges on a session row no longer overlap: one running and
  two queued sessions show all three states without hiding each other
- A queue summary bar at the top of the list switches to the "In progress" filter in one tap
- Every session row gains "Files" and "Knowledge" shortcuts that do not leave the current session
- The web build can be installed to the home screen, with fallbacks for download and sharing inside
  the browser
