---
id: "c3e3acd4-51c9-4886-8624-26afec3e1767"
type: "task"
title: "Re-export rex placement through the web rex gateway"
slug: "re-export-rex-placement-through-the"
description: "Add PR 1's exports (`suggestPlacement`, `recordPlacement`, `recordProposal`, `ChangePlacementError`, the strength helper and their types) to `packages/web/src/server/rex-gateway.ts`. Re-export only, no logic (domain-isolation.test.js). Type imports go through the gateway too. Read `docs/architecture/gateways.md` first and update its export inventory; if the ceiling in `tests/e2e/architecture-policy.test.js` would be exceeded, raise it there with the reason in the same commit."
acceptanceCriteria:
  - "The placement symbols import from server/rex-gateway.ts"
  - "docs/architecture/gateways.md lists them"
  - "domain-isolation.test.js and architecture-policy.test.js pass"
priority: "high"
tags:
  - "inbox-placement"
  - "web"
source: "ndx-capture"
---
