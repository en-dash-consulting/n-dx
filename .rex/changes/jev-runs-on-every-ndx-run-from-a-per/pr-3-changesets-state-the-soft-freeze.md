---
id: "3da75c2f-d41c-42dd-8e42-4d80380aa796"
type: "task"
title: "PR 3 changesets state the soft-freeze impact"
slug: "pr-3-changesets-state-the-soft-freeze"
description: "PR 3's changesets (.changeset/jev-availability-visible.md, dashboard-credential-store-keys.md, auth-messages-cli-first.md) lack the soft-freeze line every changeset in this lane carries (see .changeset/vendor-auth-setting.md for the form). Add one paragraph to each, starting 'Soft freeze:'. jev-availability-visible: llm.typesafe.required and --test are new ndx config keys and flags; ndx status gains a jev line; rex get_capabilities gains an additive jev field and sourcevision's manifest lastAnalysis an optional jev field, so MCP output grows but no field changes or disappears. dashboard-credential-store-keys: no CLI, config or MCP surface changes; the footer and init wizard behave as before when nothing is stored. auth-messages-cli-first: message text only; no key, flag, exit code or MCP tool changes. Changeset text only, all bumps stay patch."
acceptanceCriteria:
  - "Each of the three changesets has a Soft freeze paragraph matching the description, and every bump stays patch"
  - "changeset status passes and no other file changes"
priority: "low"
source: "credential-injection-design"
---
