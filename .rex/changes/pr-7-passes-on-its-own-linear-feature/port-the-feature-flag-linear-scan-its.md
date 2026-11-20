---
id: "6867a04d-1768-4a5c-b71b-bbb13d2dd183"
type: "task"
title: "Port the feature-flag linear scan, its docs and changeset from 87292366a"
slug: "port-the-feature-flag-linear-scan-its"
summary: "Brings the reviewed fix for the last slow text pattern into this part, with the release note for the whole fix."
description: "Port from 87292366a:\n- the hunks in `packages/lang-kit/src/pack-contract.ts`;\n- in `packages/lang-kit/tests/unit/text-trim.test.ts`, the `normalizeFlagName on repository input` describe block and its `normalizeFlagName` / `PACK_CONTRACT` lines (PR 3's port left them for this layer), as restack/pr11 has them;\n- `.changeset/php-linear-config-scans.md` (new), verbatim: it covers PRs 3 to 7's ports, which ship in one release;\n- the **Linear scans** bullet it adds to `docs/packages/sourcevision.md`.\nTests: lang-kit suite and `pnpm --filter @n-dx/lang-kit exec tsc --noEmit`; from the repository root `npx vitest run tests/e2e/changeset-body-policy.test.js tests/e2e/docs-command-refs.test.js`."
acceptanceCriteria:
  - "pack-contract.ts matches restack/pr11's hunk"
  - "The changeset and docs bullet match 87292366a"
  - "lang-kit suite, typecheck and changeset-body-policy pass"
priority: "high"
run: {"tier":"standard","skipTestGate":true}
---
