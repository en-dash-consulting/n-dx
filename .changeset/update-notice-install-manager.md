---
"@n-dx/core": patch
---

The "Update available" notice now suggests an upgrade command that actually works.

Previously it always printed `npm i -g @n-dx/core`, regardless of how the copy was installed, which failed two ways:

- **Wrong package manager.** A pnpm-global user following `npm i -g` ends up with a second global install under the npm prefix. Both ship an `ndx` shim, and whichever resolves first on `PATH` wins — so `ndx --version` can keep reporting the old version even though the upgrade "succeeded". `update-check.js` now infers the installing manager from its own path on disk (pnpm's `.pnpm` virtual store, yarn's data directory, else npm) and prints the matching `pnpm add -g` / `yarn global add` / `npm i -g` form.
- **Missing `@latest`.** pnpm records a caret range in its global manifest, and for 0.x versions `^0.3.1` means `>=0.3.1 <0.4.0`. A bare `pnpm add -g @n-dx/core` or `pnpm update -g` re-resolves inside that range and can never cross a minor boundary, leaving users stranded on an old line indefinitely. The suggested command now always pins `@n-dx/core@latest`.

Adds a `docs/guide/troubleshooting.md` entry for the `ERR_MODULE_NOT_FOUND … assistant-assets/index.js` crash that 0.3.x installs hit, since that failure occurs while Node links the module graph — before any `ndx` code can run and surface an update notice. Documents the upgrade-pinning rule in the README install section.
