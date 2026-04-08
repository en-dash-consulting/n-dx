---
name: dev-link
description: Swap between local n-dx development build and published npm version
argument-hint: "[local|npm]"
---

Swap between using the local development build of n-dx and the published npm version.

## Commands

- `/dev-link local` — Link the local `packages/core` build globally so `ndx` uses your dev code
- `/dev-link npm` — Unlink local and install `@n-dx/core` from the npm registry
- `/dev-link` (no argument) — Show which version is currently active and where it resolves from

## Switch to local dev build

1. Ensure the local build is current: `pnpm build --filter @n-dx/core`
2. Remove the npm-installed version if present: `pnpm remove -g @n-dx/core`
3. Link from the core package directory: `cd packages/core && pnpm link --global`
4. Verify: `pnpm ls -g --depth=0` should show `@n-dx/core link:...packages/core`
5. Verify binaries: `which ndx` should resolve to the pnpm global bin, `ndx --version` should match local

## Switch to npm registry version

1. Remove the global link: `pnpm remove -g @n-dx/core`
2. Install from npm: `pnpm add -g @n-dx/core`
3. Verify: `pnpm ls -g --depth=0` should show `@n-dx/core X.Y.Z` (a version number, not a link)
4. Verify binaries: `ndx --version` should match the published version

## Show current state

1. Run `pnpm ls -g --depth=0` and check `@n-dx/core` entry
2. If it shows `link:...` — local dev build is active
3. If it shows a version number — npm registry version is active
4. Also check `which ndx` and `ndx --version` to confirm binary resolution
5. Report clearly: "Currently using: **local dev** (linked from packages/core)" or "Currently using: **npm v{X.Y.Z}**"
6. Show the command to swap to the OTHER mode:
   - If currently local: "To switch to npm: `/dev-link npm`"
   - If currently npm: "To switch to local dev: `/dev-link local`"

## Important notes

- Always use `pnpm` (not `npm`) for global link/install — this repo uses pnpm and binaries resolve through pnpm's global bin directory
- The global package name must be `@n-dx/core` (from `packages/core/package.json`) — never link from the monorepo root (which has name `n-dx` and no bin entries)
- After switching to local, remember to `pnpm build` after code changes for them to take effect via the global link
- The link registers these binaries: `ndx`, `n-dx`, `rex`, `hench`, `sourcevision`, `sv`
