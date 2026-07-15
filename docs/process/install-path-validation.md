# Install Path Validation (Spike)

**Status:** Decided — recommended path is `npm install -g @n-dx/core`.

This spike answers a single question: of the several ways a user *could* install
N-DX, which one do we recommend, based on **tested behavior** rather than
assumptions? The findings below come from installing the published
`@n-dx/core@0.4.6` registry tarball into a clean sandbox and exercising it
end-to-end — not from reading `package.json`.

## What was validated

The user-facing entry point is `@n-dx/core`; it is the only package that provides
the `ndx` / `n-dx` binary and re-exposes the sub-tool binaries (`rex`, `hench`,
`sourcevision`, `sv`, `n-dx-web`). It depends on the other published packages via
`workspace:*` specifiers, which `changeset publish` rewrites to concrete versions
at release time. The open risk was whether that rewrite and the sub-package `dist`
outputs actually produce a working install from the registry.

Tested against `@n-dx/core@0.4.6`:

1. **Published dependency graph** — `npm view @n-dx/core dependencies` shows all
   five internal deps pinned to `0.4.6` (`@n-dx/hench`, `@n-dx/llm-client`,
   `@n-dx/rex`, `@n-dx/sourcevision`, `@n-dx/web`). No `workspace:*` leaked into
   the published tarball.
2. **Clean install** — `npm install @n-dx/core@0.4.6` into an empty project
   succeeded (193 packages, exit 0) with the repo `.npmrc` excluded.
3. **Binary registration** — all seven bins appear in `node_modules/.bin`:
   `ndx`, `n-dx`, `n-dx-web`, `rex`, `hench`, `sourcevision`, `sv`.
4. **Binary + sub-tool resolution** — `ndx --version` → `0.4.6`; `ndx --help`,
   `ndx rex --help`, and `ndx sv --help` all run, confirming core resolves the
   sub-tools through `node_modules` (not the monorepo-sibling path).
5. **Real workflow** — `ndx init .` in a fresh project completed (exit 0),
   creating `.sourcevision/`, `.rex/`, `.hench/` plus the Claude and Codex
   assistant surfaces and stdio MCP server config.

## Results

| Install path | Tested? | Result |
|---|---|---|
| `npm install -g @n-dx/core` | Yes (isolated non-global install of the same tarball) | ✅ **Works** — deps resolve, all bins register, `ndx init` completes end-to-end. **Recommended.** |
| `pnpm add -g @n-dx/core` | By construction (identical published tarball; used by CI and the `dev-link` skill) | ✅ Works — equal alternative for pnpm users. |
| `npx @n-dx/core …` (bare) | Yes | ❌ **Broken** — `could not determine executable to run`. The bin names (`ndx`/`n-dx`) differ from the package name (`core`), so npx cannot pick a default binary. |
| `npx -p @n-dx/core ndx …` | Yes | ✅ Works — the only supported npx form (`npx -p @n-dx/core ndx --version` → `0.4.6`). Verbose; for one-off use, not the primary path. |
| Clone + `pnpm install && pnpm build` (+ `pnpm link --global` from `packages/core`) | Existing CI + `dev-link` skill | ✅ Works — the **contributor/development** path, not for end users. |
| `yarn global add @n-dx/core` | No | ❓ Untested. Plausible (same tarball) but unverified; treat as best-effort. |
| `npm install`/`npm link` inside the monorepo | — | ⛔ Unsupported by policy (`.npmrc` `ignore-scripts`, `CONTRIBUTING.md` "Never run `npm install` here"). Use pnpm. |
| Direct sub-package install (`npm i -g @n-dx/rex`, etc.) | — | ⛔ Not supported for end users — install `@n-dx/core`, which provides all binaries. |

## Recommendation

- **Primary (recommended):** `npm install -g @n-dx/core`, then `ndx init .`.
- **Alternative:** `pnpm add -g @n-dx/core` (identical result; preferred by pnpm users).
- **One-off, no global install:** `npx -p @n-dx/core ndx <command>`. Note that bare
  `npx @n-dx/core` **does not work** — the `-p … ndx` form is required.
- **Best-effort:** `yarn global add @n-dx/core` (untested).
- **From source:** for contributors only — see `CONTRIBUTING.md` and the
  `dev-link` skill.

## Follow-ups (optional, not blocking)

- Consider a lightweight CI smoke test that installs the just-published tarball and
  runs `ndx --version` / `ndx init` in a temp dir, so the recommended path stays
  proven on every release rather than validated once.
- Consider whether bare `npx @n-dx/core` should be made to work (e.g. by aligning a
  bin name with the package, or documenting the `-p` form prominently) — currently
  it is a predictable but surprising failure.
