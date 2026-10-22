# Workflows

Every workflow runs on `main` only. Direct pushes land on `main`; there are no branches or pull requests in the normal flow, no Dependabot, and no scheduled stale or label automation. Dependency updates are applied manually on `main`.

`stale.yml` exists only because the ecosystem drift checker (`required-workflows`, presence-only) lists it as required for cursor-plugin repos and offers no per-repo override outside the meta-repo config. It is `workflow_dispatch` only and dry-runs by default; that keeps `drift-check.yml` green without reintroducing the automation (#9).

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ci.yml` | push, pull request, manual | Build, vitest for every package and the repository tests, validate and preflight `examples/hello-counter`, LuaLS check of `examples/hello-counter` and of a plain and a `--prettyui` scaffold against the stubs. Matrix: windows-latest and ubuntu-latest, Node 22 and 24. Queued runs on the same ref coalesce; in-flight runs on `main` are never cancelled. |
| `stubs-regenerate.yml` | weekly (Monday 06:00 UTC), manual | Regenerates `packages/luals-stubs` from developer.runescape.com, runs tests and the LuaLS check, and commits to `main` as github-actions[bot] with `chore(stubs): regenerate from docs` when anything changed. |
| `validate.yml` | push, pull request, manual | Cursor plugin manifest, skill and rule frontmatter, README counts, credential scan, writing style. |
| `release.yml` | manual only (`gh workflow run release.yml`) | Requires a green `ci.yml` run for the commit (input `require_ci`), builds and tests it, conventional-commit version bump across `.cursor-plugin/plugin.json`, every `package.json`, the README badge and the `CHANGELOG.md` `Unreleased` heading, commits without `[skip ci]`, tags, GitHub Release with npm tarballs and the stubs zip plus SHA-256 sums. Pre-1.0 bump rule: breaking changes bump the minor, features and fixes the patch. |
| `drift-check.yml` | push, pull request, manual | Ecosystem standards drift check (Developer-Tools-Directory action, `mode: self`). |
| `stale.yml` | manual only | Present because the ecosystem drift check requires it for cursor-plugin repos. It has no schedule; a manual run defaults to a dry run that only reports. The repository policy stays: no stale automation. |
| `pages.yml` | push touching plugin content, manual | Builds the GitHub Pages site with the shared site template; `cursor-plugin/skills` and `cursor-plugin/rules` are staged as `skills/` and `rules/` because the template expects them at the root. Requires Pages to be enabled with the GitHub Actions source. |
| `codeql.yml` | push, pull request, weekly | CodeQL for TypeScript. |

## Action pinning

GitHub-published actions (`actions/*`, `github/*`) use major-version tags. The Developer-Tools-Directory composite actions are pinned to the meta-repo `MAJOR.MINOR` (`drift-check@v1.20`) and `MAJOR` (`release-doc-sync@v1`) trains, as the ecosystem standards require. No other third-party actions are used; LuaLS is downloaded from its pinned GitHub release (`LUALS_VERSION`). Bump the pin deliberately.

## Branch protection

`main` is not protected by a ruleset so that the scheduled stub regeneration and the manual release can push directly. If protection is added later, allow the `github-actions[bot]` pushes from `stubs-regenerate.yml` and `release.yml`.
