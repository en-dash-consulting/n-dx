# Integration Tests — `.js` Extension Convention

All root-level test files (including this directory) use the **`.js` extension**,
not `.ts`.

## Why

Root-level integration tests import from **compiled `dist/` artifacts** via the
packages' public API entry points. Using plain `.js` prevents:

1. **TypeScript alias resolution** — vitest's alias config in package-level
   `vitest.config.ts` maps `.js` imports to `.ts` source files. Root-level tests
   intentionally bypass this so they test the *published* contract, not source
   internals.
2. **dist/-only import guarantee** — by staying in `.js`, these tests can only
   reach `dist/` exports. A `.ts` file could accidentally import source modules
   directly, silently breaking the zone fidelity contract.

## Convention

- New integration test files **must** use the `.test.js` extension.
- The root `vitest.config.js` enforces this: `include: ["tests/**/*.test.js"]`.
- Package-internal tests (under `packages/*/tests/`) use `.test.ts` — that
  convention is separate and does not apply here.
