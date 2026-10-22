# Contributing to RS3 Developer Tools

Thank you for your interest in contributing.

## Getting started

1. Fork the repository and clone your fork.
2. Install Node.js 22 or later, then run `npm install` and `npm run build`.
3. Make your change with tests, run `npm test`, and open a pull request against `main`.

Maintainers commit directly to `main`; external contributions arrive as pull requests and are squash-merged.

## Conventions

### Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` -- new feature, skill, rule, MCP tool, or preflight check
- `fix:` -- bug fix
- `docs:` -- documentation changes
- `chore:` -- maintenance, dependency updates
- `refactor:`, `test:`, `ci:` -- as named

No emojis and no em dashes in commits, code, or docs.

### Skills and rules

- Skills: `cursor-plugin/skills/<name>/SKILL.md` with `name`, `description`, `triggers`, `standards-version` frontmatter; under 250 lines.
- Rules: `cursor-plugin/rules/rs3-<topic>.mdc` with `description`, `globs`, `alwaysApply`, `standards-version`; under 100 lines.
- Add every new path to `.cursor-plugin/plugin.json` and update the counts in `README.md`.

### Code

- TypeScript strict ESM, vitest, no new runtime dependencies without discussion.
- Generated Lua must be readable and commented.
- Never add documentation prose from developer.runescape.com, and never add code or data taken from other developers' plugins.

## Pull request process

1. CI must pass (`ci.yml`, `validate.yml`, `drift-check.yml`, `codeql.yml`).
2. Update `CHANGELOG.md` for user-facing changes.
3. Use a conventional-commit PR title; it becomes the squash commit subject.

## Releases and dependencies

Releases are cut manually by a maintainer with `gh workflow run release.yml`. The workflow refuses a commit without a green `ci.yml` run (override with `require_ci=false` only after checking by hand), builds and tests that commit, determines the bump from the conventional commits since the last tag, updates `.cursor-plugin/plugin.json`, the root and workspace `package.json` files, the README badge and the `CHANGELOG.md` `Unreleased` heading, commits to `main` (CI runs on that commit), tags, and creates the GitHub Release with the npm tarballs and `rs3-luals-stubs-<version>.zip` attached and their SHA-256 in the notes.

Bump rule while the major version is 0: a breaking change (`feat!`, `fix!`, `BREAKING CHANGE`) bumps the minor, and every feature or fix bumps the patch. From 1.0.0 on, breaking changes bump the major and features the minor.

Dependency updates are applied manually on `main`; the repository has no Dependabot configuration.

### Docs drift checklist before a release

- `CHANGELOG.md` has every user-facing change under `## [Unreleased]` (the workflow dates it).
- `README.md`, `packages/cli/README.md` and `packages/mcp/README.md` describe the current flags, tools and defaults (`rs3dev <command> --help` is the source of truth).
- `AGENTS.md` and `.github/workflows/README.md` describe the workflows and entry points as they are.
- `SECURITY.md` names the scanning that actually runs.
- `npm run build && npm test` and `node scripts/luals-check.mjs examples/hello-counter` pass locally.

## Inbound license grant and DCO

This project's outbound license is MIT. Contributions are accepted inbound under a broader grant via the Developer Certificate of Origin (DCO).

### Required grant

By submitting a contribution to this repository, you certify that you have the right to do so under the Developer Certificate of Origin (DCO) 1.1, and you grant TMHSDigital a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, reproduce, prepare derivative works of, publicly display, publicly perform, sublicense, and distribute your contribution under the project's current license (MIT) or any successor license chosen by the project.

### DCO sign-off

Submitting a contribution is your certification under the DCO and your acceptance of the grant above; no `Signed-off-by:` trailer is required and none is checked by automation. You are welcome to add one with `git commit -s` if your employer or your own policy asks for it.

For the full inbound and outbound model, see [`standards/licensing.md`](https://github.com/TMHSDigital/Developer-Tools-Directory/blob/main/standards/licensing.md) in the Developer-Tools-Directory meta-repo.
