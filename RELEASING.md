# Releasing n-dx

Only the root `n-dx` package is published to npm. Sub-packages (`rex`, `hench`, `sourcevision`, `@n-dx/llm-client`, `@n-dx/web`) are bundled inside it and marked `private: true`.

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
2. That PR bumps `version` in `package.json`, writes `CHANGELOG.md`, and removes consumed changeset files
3. Review the PR — it shows exactly what version bump and changelog entries will be created
4. **Merge the "Version Packages" PR** → the workflow runs `changeset publish`, which:
   - Publishes to npm
   - Creates a git tag (`n-dx@x.y.z`)

### Required secrets

The release workflow needs an `NPM_TOKEN` secret in the GitHub repo settings. Create one at [npmjs.com/settings/tokens](https://www.npmjs.com/settings/tokens) with publish permission.

## What gets published

The `files` field in `package.json` controls the tarball contents:

- Root orchestration scripts (`cli.js`, `config.js`, `web.js`, `ci.js`, etc.)
- Compiled sub-packages (`packages/*/dist/` + their `package.json` files)
- `LICENSE`, `README.md`, `package.json` (included automatically by npm)

Verify with `npm pack --dry-run` before publishing.

## CLI commands registered on install

When users run `npm i -g @n-dx/core`, these commands become available:

| Command | Binary |
|---------|--------|
| `n-dx` / `ndx` | `cli.js` |
| `rex` | `packages/rex/dist/cli/index.js` |
| `hench` | `packages/hench/dist/cli/index.js` |
| `sourcevision` / `sv` | `packages/sourcevision/dist/cli/index.js` |

## Git tags

Created automatically by `changeset publish`. Format: `n-dx@0.2.0`. No manual tagging needed.
