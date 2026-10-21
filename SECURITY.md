# Security Policy

## Reporting a vulnerability

Report vulnerabilities through GitHub Security Advisories for this repository: https://github.com/TMHSDigital/RS3-Developer-Tools/security/advisories/new. Do not open a public issue.

## Scope

This repository contains:

- A documentation crawler that fetches pages from developer.runescape.com and writes LuaLS stub files and a per-user cache.
- A command line tool that reads a plugin folder, copies it into the RuneScape beta client's `dev_plugins` folder, and writes zip archives.
- An MCP server (stdio) that exposes those functions to AI clients, restricted to the workspace and `dev_plugins` paths.

Threat surface: path handling in the sync, scaffold and package tools (writes must stay inside the workspace or `dev_plugins`), HTML parsing of fetched documentation, and the GitHub Actions workflows that commit to `main`.

## Out of scope

- Vulnerabilities in the RuneScape client, the RuneScape Client API, mod.io, GitHub, Cursor, or the MCP specification.
- Vulnerabilities in upstream npm dependencies (report to those projects); Dependabot and `codeql.yml` track them.
- Plugins written by users of this toolkit.

## Supported versions

| Version | Supported |
| --- | --- |
| latest release on `main` | yes |
| older tags | no |

## Response timeline

- Acknowledgment within 48 hours of the report.
- Initial assessment within 7 days.
- Fix or documented mitigation within 14 days for critical severity, 30 days for high, best effort for medium and low.
- Reporters are credited in the advisory unless they ask otherwise.
