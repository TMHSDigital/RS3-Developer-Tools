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

## Inbound license grant and DCO

This project's outbound license is MIT. Contributions are accepted inbound under a broader grant via the Developer Certificate of Origin (DCO).

### Required grant

By submitting a contribution to this repository, you certify that you have the right to do so under the Developer Certificate of Origin (DCO) 1.1, and you grant TMHSDigital a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, reproduce, prepare derivative works of, publicly display, publicly perform, sublicense, and distribute your contribution under the project's current license (MIT) or any successor license chosen by the project.

### DCO sign-off

Every commit in a pull request must carry a `Signed-off-by:` trailer matching the commit author. Sign at commit time with the `-s` flag:

```bash
git commit -s -m "feat: add new skill"
```

For the full inbound and outbound model, see [`standards/licensing.md`](https://github.com/TMHSDigital/Developer-Tools-Directory/blob/main/standards/licensing.md) in the Developer-Tools-Directory meta-repo.
