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

1. Ensure the local build is current: `pnpm --filter "@n-dx/core..." build`

   The filter must come **before** the script name. The root `build` script is `pnpm -r run build`, so `pnpm build --filter @n-dx/core` passes `--filter` through to `tsc` and dies with `error TS5023: Unknown compiler option '--filter'`. The trailing `...` builds core's dependencies too — core itself is plain JS with no build step, so an un-suffixed filter compiles nothing.
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

## Windows (PowerShell / cmd)

The `pnpm` commands above are cross-platform and identical on Windows. Only two things differ: the binary-resolution check (`which` → `Get-Command`/`where`) and command chaining (`&&` is not valid in `cmd` or Windows PowerShell 5.1). Run the `cd` as its own step.

Switch to local dev build:

```powershell
pnpm --filter "@n-dx/core..." build   # filter BEFORE the script — see step 1 above
pnpm remove -g @n-dx/core          # ignore error if not installed
cd packages\core
pnpm link --global
cd ..\..
pnpm ls -g --depth=0               # expect: @n-dx/core link:...\packages\core
Get-Command ndx                    # PowerShell — resolves to the pnpm global bin
ndx --version                      # should match local
```

Switch to npm registry version:

```powershell
pnpm remove -g @n-dx/core
pnpm add -g @n-dx/core
pnpm ls -g --depth=0               # expect: @n-dx/core X.Y.Z (a version, not a link)
ndx --version                      # should match published version
```

Notes for Windows:
- Binary check: `Get-Command ndx` in PowerShell, or `where.exe ndx` in `cmd` (the `which` equivalent).
- Chaining: PowerShell 7+ accepts `&&`; `cmd` accepts `&&`; Windows PowerShell 5.1 does **not** — use `;` or separate lines.
- Path separators: use `packages\core` (or `packages/core` — pnpm accepts both).
- Ensure pnpm's global bin is on `PATH`. Run `pnpm setup` once if `ndx` is not found after linking, then restart the shell.

## Important notes

- Always use `pnpm` (not `npm`) for global link/install — this repo uses pnpm and binaries resolve through pnpm's global bin directory
- The global package name must be `@n-dx/core` (from `packages/core/package.json`) — never link from the monorepo root (which has name `n-dx` and no bin entries)
- After switching to local, remember to `pnpm --filter "@n-dx/core..." build` after code changes for them to take effect via the global link
- The link registers these binaries: `ndx`, `n-dx`, `rex`, `hench`, `sourcevision`, `sv`
- **Never invoke via `npx` while testing a local build.** `npx ndx` ignores the global pnpm link — there is no `node_modules/.bin/ndx` in this repo, so npx resolves a registry copy and caches it. That copy silently goes stale: with 0.5.1 linked, `npx ndx --version` still reported `0.4.6`, and behavior differed enough to produce a wrong bug report (a "token usage is not captured" message that no longer exists in current source). Call the bare `ndx` / `rex` / `hench` binaries so the link is what runs. If a version or a message looks wrong, check `ndx --version` against `packages/core/package.json` before believing it.
