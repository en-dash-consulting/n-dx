---
id: "c8fccd87-092f-4701-91ee-a805da70b8bb"
level: "task"
title: "Let a project opt in to restricted-import rules in ndx ci"
status: "pending"
priority: "medium"
acceptanceCriteria:
  - "A project that configures a restricted-import rule fails `ndx ci` on a file importing that module outside its allow list, and passes once the file is allowed (test)"
  - "A project with no rule configured reports the step as skipped and never fails it (test)"
  - "`ndx ci .` on the n-dx monorepo still enforces packages/core/child-process-allowlist.json, and the ci.js / architecture-policy.test.js parity test still passes"
  - "The configuration key is documented in docs/guide/configuration.md"
description: "Follow-up to a127abde / PR #587, which runs the `ndx ci` architecture-policy step only on the n-dx monorepo. Decision (Ryan, 2026-10-08): let any project opt in to the same capability, as a general rule rather than n-dx's own allowlist.\n\nCapability: \"this module may only be imported from these files\". A user names their own wrapper and exceptions; n-dx's packages/core/child-process-allowlist.json becomes one instance of the same mechanism.\n\nProposed shape (settle the exact key during the task), in .n-dx.json:\n  \"ci\": { \"restrictedImports\": [ { \"module\": \"node:child_process\", \"allow\": [\"src/lib/exec.ts\", \"scripts/release.js\"] } ] }\n\n- With nothing configured the step is skipped and reported as skipped (today's behaviour from #587).\n- On the n-dx monorepo the step keeps enforcing child-process-allowlist.json; the parity test between ci.js and tests/e2e/architecture-policy.test.js must still hold.\n- A violation names the file, the module and the config entry, and says how to allow it.\n- Orchestration stays spawn-only: packages/core/ci.js reads .n-dx.json through the existing config path (config.js is the only spawn-exempt script), no package imports.\n- In the 1.0.0 model this is a constraint (a rule across capabilities, checked by a test); keep the config shape small so a later constraint can point at it.\n- Patch changeset for @n-dx/core. Document the key in docs/guide/configuration.md.\n- The hench sandbox pre-approves only npm, npx, node, git, tsc and vitest commands; never pnpm."
lastModified: "2026-10-08T16:48:28.748Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
