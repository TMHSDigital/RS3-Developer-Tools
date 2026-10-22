# Pull Request

## Summary

<!-- One or two sentences on what changes and why. The title is the conventional-commit subject used for the squash commit. -->

## Type of change

- [ ] `feat` - new check, command, MCP tool, rule, skill or stub improvement
- [ ] `fix` - correction to existing behaviour
- [ ] `docs` - docs-only edit
- [ ] `chore` - dependencies, cleanup
- [ ] `ci`, `refactor`, `test` - as named

## Hard constraints (see AGENTS.md)

- [ ] No documentation prose from developer.runescape.com was added; stubs and messages carry signatures and `@see` links only
- [ ] No code or data taken from other developers' plugins
- [ ] No emojis and no em or en dashes in code, docs or commit messages
- [ ] No real email addresses other than a plugin's own `contactEmailAddress`; fixtures use placeholder domains

## Checks

- [ ] `npm run build && npm test` passes locally
- [ ] If `packages/stubs-generator` changed: `npm run stubs:generate` was run and the regenerated `packages/luals-stubs` is in this PR
- [ ] If a preflight check was added: a fixture under `packages/core/src/__tests__/fixtures/plugins/` and a test cover it, and the `preflight-and-package` skill lists the code
- [ ] If a skill or rule changed: `.cursor-plugin/plugin.json` and the README counts still match
- [ ] `CHANGELOG.md` has an entry under `Unreleased` for user-facing changes

## Licensing

By opening this pull request you accept the inbound grant in CONTRIBUTING.md (DCO 1.1); a `Signed-off-by:` trailer is welcome but not required.

## Linked issues

<!-- Closes #123 -->
