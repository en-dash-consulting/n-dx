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
   - Creates git tags

### Required secrets

The release workflow needs an `NPM_TOKEN` secret in the GitHub repo settings. Create one at [npmjs.com/settings/tokens](https://www.npmjs.com/settings/tokens) with publish permission scoped to `@n-dx/*`.

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

## Git tags

Created automatically by `changeset publish`. Format: `@n-dx/core@0.2.0`. No manual tagging needed.
