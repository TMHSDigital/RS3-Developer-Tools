# Workflows

Every workflow runs on `main` only. Direct pushes land on `main`; there are no branches or pull requests in the normal flow.

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ci.yml` | push, pull request, manual | Build, vitest for every package and the repository tests, validate and preflight the example, LuaLS check of `examples/` against the stubs. Matrix: windows-latest and ubuntu-latest, Node 22 and 24. |
| `stubs-regenerate.yml` | weekly (Monday 06:00 UTC), manual | Regenerates `packages/luals-stubs` from developer.runescape.com, runs tests and the LuaLS check, and commits to `main` as github-actions[bot] with `chore(stubs): regenerate from docs` when anything changed. |
| `validate.yml` | push, pull request, manual | Cursor plugin manifest, skill and rule frontmatter, README counts, credential scan, writing style. |
| `release.yml` | push (non-docs paths), manual | Conventional-commit version bump across `.cursor-plugin/plugin.json` and every `package.json`, tag, GitHub Release. |
| `drift-check.yml` | push, pull request, manual | Ecosystem standards drift check (Developer-Tools-Directory action, `mode: self`). |
| `pages.yml` | push touching plugin content, manual | Builds the GitHub Pages site with the shared site template; `cursor-plugin/skills` and `cursor-plugin/rules` are staged as `skills/` and `rules/` because the template expects them at the root. |
| `codeql.yml` | push, pull request, weekly | CodeQL for TypeScript. |
| `stale.yml` | weekly | Marks and closes inactive issues and PRs. |
| `label-sync.yml` | pull request | Labels PRs by changed paths. |

## Action pinning

GitHub-published actions (`actions/*`, `github/*`) use major-version tags. The Developer-Tools-Directory composite actions are pinned to the meta-repo `MAJOR.MINOR` (`drift-check@v1.20`) and `MAJOR` (`release-doc-sync@v1`) trains, as the ecosystem standards require. No other third-party actions are used; LuaLS is downloaded from its pinned GitHub release (`LUALS_VERSION`) with a checksum-free download because the project does not publish checksums; bump the pin deliberately.

## Branch protection

`main` is not protected by a ruleset at the time of writing so that the scheduled stub regeneration can push directly. If protection is added later, allow the `github-actions[bot]` pushes from `stubs-regenerate.yml` and `release.yml`.
