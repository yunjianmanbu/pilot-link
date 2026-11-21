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
