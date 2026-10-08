---
id: "ea6dd696-ab1b-46dd-9241-bfb555d2682d"
level: "task"
title: "Keep the build stamp out of the published npm packages"
status: "in_progress"
priority: "medium"
startedAt: "2026-10-08T17:20:16.775Z"
acceptanceCriteria:
  - "hench, llm-client, rex, sourcevision and web exclude dist/.build-stamp.json from their published files"
  - "A root test fails when a package's build script writes the stamp but its files field does not exclude it"
  - "A pack dry-run of a built package does not list dist/.build-stamp.json (test)"
  - "The stamp still lives in dist/, and the affected gate's stale-build tests still pass"
description: "Follow-up on PR #588 (task 7cad623b, run 7096c9b0). Decision (Ryan, 2026-10-08): do not ship the build stamp to npm.\n\nEach full package build now writes dist/.build-stamp.json, and `npm pack --dry-run` shows it in the tarballs of hench, llm-client, rex, sourcevision and web because their package.json `files` include \"dist\". The stamp is build bookkeeping for the repository's affected test gate, not runtime content (like tsconfig.tsbuildinfo, which already stays out of the tarball).\n\n- Keep the stamp inside dist/ (deleting dist must delete the stamp, or a partial build after a clean would read as fresh). Exclude it through `files`: add \"!dist/.build-stamp.json\" beside the existing \"!dist/**/*.map\" in each of the five packages.\n- Add a guard so a future package cannot forget it: every package whose build script runs write-build-stamp.mjs must exclude the stamp from `files` (a static check in a root test), and a pack dry-run of one built package must not list dist/.build-stamp.json. tests/e2e/published-assets-bundled.test.js already inspects `pnpm pack --dry-run --json` output; extend that or add a sibling test.\n- No new changeset: .changeset/build-stamp-freshness.md already patches the same five packages; extend its sentence if useful.\n- The hench sandbox pre-approves only npm, npx, node, git, tsc and vitest commands; never pnpm."
lastModified: "2026-10-08T17:20:17.027Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
