# Releasing n-dx

All packages (`@n-dx/core`, `@n-dx/rex`, `@n-dx/hench`, `@n-dx/sourcevision`, `@n-dx/llm-client`, `@n-dx/web`) are published to npm. They share a single version number via a [Changesets fixed group](https://github.com/changesets/changesets/blob/main/docs/fixed-packages.md).

## How versioning works

We use [Changesets](https://github.com/changesets/changesets) for version management, changelogs, and git tags.

### Adding a changeset

When a PR includes a notable change (feature, fix, breaking change), add a changeset:

```sh
pnpm changeset
```

This prompts you to pick a bump level:
- **patch** (0.1.0 → 0.1.1) — bug fixes
- **minor** (0.1.0 → 0.2.0) — new features, non-breaking
- **major** (0.1.0 → 1.0.0) — breaking changes

Write a short description of the change. This becomes the CHANGELOG entry.

Multiple changesets can accumulate between releases. Changesets picks the highest bump level across all pending changesets.

### What gets committed

A `.changeset/<random-name>.md` file is created. Commit it with your PR — it's consumed during the release step.

## Automated releases (GitHub Actions)

After merging PRs with changeset files to `main`:

1. The release workflow opens (or updates) a **"Version Packages"** PR
2. That PR bumps `version` in all packages, writes `CHANGELOG.md`, and removes consumed changeset files
3. Review the PR — it shows exactly what version bump and changelog entries will be created
4. **Merge the "Version Packages" PR** → the workflow runs `changeset publish`, which:
   - Publishes all packages to npm (using `pnpm publish`, which resolves `workspace:*` to real versions)
   - Creates git tags on the runner and reports them to `changesets/action@v2` through the `CHANGESETS_OUTPUT` NDJSON file
5. `changesets/action@v2` pushes every reported tag to origin and creates one **GitHub release per package** (`@n-dx/core@0.7.0`, `@n-dx/rex@0.7.0`, …), using that package's `CHANGELOG.md` section as the release body
6. A final **"Verify tags and GitHub releases match npm"** step fails the job if npm has the version but origin lacks any tag or GitHub lacks any release — so npm and GitHub cannot drift silently

### Required secrets

None for npm. Publishing uses [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC): each `@n-dx/*` package has a Trusted Publisher configured at npmjs.com pointing at this repo, `release.yml`, and the `npm` GitHub environment. The workflow's `id-token: write` permission lets npm mint a short-lived publish credential per run; there is no long-lived token to rotate. Trusted publisher config is per package, so a new package needs its own entry before its first publish. To check the config without publishing, run the Release workflow manually with mode `validate-oidc`.

Git tags, GitHub releases, and the "Version Packages" PR use the workflow's built-in `GITHUB_TOKEN` (`contents: write`, `pull-requests: write`).

## What gets published

The `@n-dx/core` package is the main CLI entry point. Its `files` field in `packages/core/package.json` controls the tarball contents:

- Orchestration scripts (`cli.js`, `config.js`, `web.js`, `ci.js`, etc.)
- `bin/` shims for direct tool access (`rex`, `hench`, `sourcevision`)
- `LICENSE`, `README.md`, `package.json` (included automatically by npm)

The sub-packages (`@n-dx/rex`, `@n-dx/hench`, etc.) are published independently and listed as dependencies of `@n-dx/core`.

Verify with `pnpm pack --dry-run` from `packages/core/`.

## CLI commands registered on install

When users run `npm i -g @n-dx/core`, these commands become available:

| Command | Binary |
|---------|--------|
| `n-dx` / `ndx` | `cli.js` |
| `rex` | `bin/rex.js` → `packages/rex/dist/cli/index.js` |
| `hench` | `bin/hench.js` → `packages/hench/dist/cli/index.js` |
| `sourcevision` / `sv` | `bin/sourcevision.js` → `packages/sourcevision/dist/cli/index.js` |

## Git tags and GitHub releases

Created automatically on every publish. One annotated tag and one GitHub release per package, both named `@n-dx/<package>@<version>` (for example `@n-dx/core@0.7.0`), pointing at the merged "Version Packages" commit. No manual tagging needed.

The mechanism: `changeset publish` (CLI v3) writes a `{"type":"git-tag", …}` line per published package to the file named by `CHANGESETS_OUTPUT`; `changesets/action@v2` sets that variable, reads the file afterwards, pushes the tags, and creates the releases. The action **must** be v2 — v1 recognised published packages only by scraping `New tag:` lines from stdout, which CLI v3 no longer prints.

### Backfilling missing tags and releases

If the verify step fails, or a version is on npm with no tag or release, run the backfill script from a checkout with `gh auth status` passing:

```sh
node scripts/backfill-release-tags.mjs            # dry run: prints every tag and release it would create
node scripts/backfill-release-tags.mjs --execute  # creates them
```

The script holds a table of `version → "chore: version packages" commit`. Add a row for the missing version (find the commit with `git log --oneline --grep="version packages"` and confirm with `git show <sha>:packages/core/package.json`). It creates annotated tags at that commit, pushes them, and creates releases whose body is the package's `CHANGELOG.md` section for that version — the same shape the action produces. It skips anything that already exists, so re-running is safe.

**Incident record.** Versions 0.5.0, 0.5.1, 0.5.2, 0.6.0 and 0.7.0 (2026-08-21 to 2026-09-18) were published to npm with no tags and no GitHub releases while every Release run stayed green. PR #334 had moved `@changesets/cli` to v3 on the day 0.5.0 shipped, and the workflow was still on `changesets/action@v1`, which silently matched nothing. Those thirty tags and releases were backfilled with the script above; the workflow moved to v2 and gained the verify step so the failure mode is now loud.
