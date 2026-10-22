# Workflows

Every workflow runs on `main` only. Direct pushes land on `main`; there are no branches or pull requests in the normal flow, no Dependabot, and no scheduled stale or label automation. Dependency updates are applied manually on `main`.

`stale.yml` exists only because the ecosystem drift checker (`required-workflows`, presence-only) lists it as required for cursor-plugin repos and offers no per-repo override outside the meta-repo config. It is `workflow_dispatch` only and dry-runs by default; that keeps `drift-check.yml` green without reintroducing the automation (#9).

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ci.yml` | push, pull request, manual | Build, Biome lint, `npm pack --dry-run` check of every workspace, one vitest run with coverage thresholds, validate, preflight, LuaLS check and package of every example, LuaLS check of every `init` template and a `--prettyui` scaffold. Matrix: windows-latest and ubuntu-latest on Node 22 and 24, plus macos-latest on Node 24. Queued runs on the same ref coalesce; in-flight runs on `main` are never cancelled. |
| `stubs-regenerate.yml` | weekly (Monday 06:00 UTC), manual | Regenerates `packages/luals-stubs` from developer.runescape.com behind the crawl guard, runs tests and the LuaLS check, writes the semantic diff of `index.json` (`scripts/stubs-diff.mjs`) to `api-changes.md`, commits to `main` as github-actions[bot] with the digest as the commit body, and posts it as an Announcements discussion. A tripped guard opens a tracking issue instead. |
| `validate.yml` | push, pull request, manual | Cursor plugin manifest, skill and rule frontmatter, README counts, credential scan, writing style. |
| `release.yml` | manual only (`gh workflow run release.yml`) | Requires a green `ci.yml` run for the commit (input `require_ci`), builds and tests it, conventional-commit version bump across `.cursor-plugin/plugin.json`, every `package.json`, the README badge and the `CHANGELOG.md` `Unreleased` heading, commits without `[skip ci]`, tags, GitHub Release with npm tarballs, the stubs zip and the LuaLS addon zip plus SHA-256 sums. With the repository variable `NPM_PUBLISH=true` (set once the `@tmhs` organisation and trusted publishers exist on npmjs.com) it then publishes every package with provenance through the OIDC token. Pre-1.0 bump rule: breaking changes bump the minor, features and fixes the patch. |
| `drift-check.yml` | push, pull request, manual | Ecosystem standards drift check (Developer-Tools-Directory action, `mode: self`). |
| `stale.yml` | manual only | Present because the ecosystem drift check requires it for cursor-plugin repos. It has no schedule; a manual run defaults to a dry run that only reports. The repository policy stays: no stale automation. |
| `pages.yml` | push touching plugin content, manual | Builds the GitHub Pages site with the shared site template; `cursor-plugin/skills` and `cursor-plugin/rules` are staged as `skills/` and `rules/` because the template expects them at the root. Requires Pages to be enabled with the GitHub Actions source. |
| `codeql.yml` | push, pull request, weekly | CodeQL for TypeScript. |
| `audit.yml` | weekly (Monday 07:00 UTC), manual | `npm audit --audit-level=high` over every dependency including dev tooling, plus an informational `npm outdated`. `ci.yml` audits production dependencies on every push. Dependabot alerts are enabled on the repository; neither opens pull requests. |

## Action pinning

Jobs that can write (`stubs-regenerate.yml` pushes to `main`, `release.yml` pushes and publishes, `pages.yml` deploys with an id token, `stale.yml` labels issues) pin every GitHub-published action to a full commit SHA with the version in a trailing comment. Read-only jobs (`ci.yml`, `validate.yml`, `codeql.yml`, `drift-check.yml`, `audit.yml`) use major-version tags and check out with `persist-credentials: false`. The Developer-Tools-Directory composite actions are pinned to the meta-repo `MAJOR.MINOR` (`drift-check@v1.20`) and `MAJOR` (`release-doc-sync@v1`) trains, as the ecosystem standards require. LuaLS is downloaded from its pinned GitHub release (`LUALS_VERSION`) and the archive's SHA-256 is checked against `LUALS_SHA256_*` before it is extracted; bump the version and the hashes together. There is no Dependabot, so SHA bumps are manual: resolve the new SHA with `gh api repos/<owner>/<action>/git/ref/tags/<tag>` and update the comment.

## Branch protection

`main` is not protected by a ruleset so that the scheduled stub regeneration and the manual release can push directly. If protection is added later, allow the `github-actions[bot]` pushes from `stubs-regenerate.yml` and `release.yml`.
