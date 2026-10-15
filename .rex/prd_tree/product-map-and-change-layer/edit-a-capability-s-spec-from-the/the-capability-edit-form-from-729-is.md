---
id: "2cc07bf3-a431-4c1c-9f4b-b28acac745d1"
level: "task"
title: "The capability edit form from #729 is unmounted and no route reaches handleProductEdit"
status: "pending"
priority: "medium"
tags:
  - "v2-hardening"
  - "web"
  - "rex"
source: "ndx-capture"
acceptanceCriteria:
  - "A POST route under the dashboard's rex product routes reaches rex's handleProductEdit through packages/web/src/server/rex-gateway.ts, inside the PRD transaction; the gateway export ceiling in tests/e2e/architecture-policy.test.js is raised with a \"Raised from X to Y for …\" entry (route test)"
  - "CapabilityPage receives onEdit from product-pages.ts, so the edit form renders for an editable capability and a submit posts to the route and refreshes the page (viewer test)"
  - "The editorial checkbox keeps #729's meaning: checked records a wording edit as history and keeps the capability met; unchecked drafts a change to build the difference (route or viewer test for both)"
  - "On a v1 project the capability page stays read-only and the route refuses (test)"
description: "Found 2026-10-14 (v2 migration-path page). #729 built a capability spec edit form, but it is unmounted. CapabilityPage (packages/web/src/viewer/views/capability.ts, around lines 229-231 and 278) renders EditForm only when onEdit is passed, and product-pages.ts (around line 109) never passes it. No server route calls rex's handleProductEdit (packages/rex/src/core/product-edit.ts; the CLI path is packages/rex/src/cli/commands/product.ts).\n\nFix direction: add a POST route under the rex product routes (packages/web/src/server/routes-rex/) that runs handleProductEdit inside the PRD transaction, reached through packages/web/src/server/rex-gateway.ts; raise the gateway export ceiling in tests/e2e/architecture-policy.test.js with a \"Raised from X to Y for …\" entry. Wire onEdit in product-pages.ts so a saved edit posts to the route and refetches. The editorial checkbox keeps #729's meaning. On a v1 project the capability page stays read-only.\n\nOperator notes: packages/web and the rex gateway export only; do not change rex core semantics. Hal's draft #742 also edits tests/e2e/architecture-policy.test.js (a different ceiling entry); keep the edit to the rex-gateway entry. Add a changeset (patch, @n-dx/web, and @n-dx/rex if rex's public exports change). Run the six static root policy tests before finishing: tests/e2e/architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy and obfuscated-code-policy."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T07:34:46.964Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
