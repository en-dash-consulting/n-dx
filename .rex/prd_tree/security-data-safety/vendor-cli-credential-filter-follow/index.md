---
id: "afd5e7a0-ffc1-4897-923d-af58f516d4d6"
level: "feature"
title: "Vendor CLI credential filter: follow-ups to #623"
status: "pending"
priority: "high"
tags:
  - "security"
  - "llm-client"
  - "hench"
source: "ndx-capture"
startedAt: "2026-10-10T19:02:48.352Z"
endedAt: "2026-10-10T19:11:38.126Z"
acceptanceCriteria: []
description: "Review findings on #623 (fix: filter credentials from vendor CLI environments, by @mikemikimike), merged as-is so a first contributor's PR stays clean. Hub review of head 54c1c53d1, 2026-10-10. Must merge before the held Version Packages PR #646 (2026-10-16) so the release never carries the Bedrock gap."
lastModified: "2026-10-10T19:25:55.668Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Claude on Bedrock keeps role, container and CA credentials](./claude-on-bedrock-keeps-role-container.md) | completed |
| [ndx start --open opens the dashboard on Windows without cmd.exe](./ndx-start-open-opens-the-dashboard-on.md) | completed |
| [The cross-vendor reviewer degrades to the shell test command when its environment cannot be resolved](./the-cross-vendor-reviewer-degrades-to.md) | completed |
| [The reviewer's shell-test fallback runs with a filtered environment](./the-reviewer-s-shell-test-fallback.md) | pending |
| [Vendor CLI environments always carry the project's policy, from one per-vendor table](./vendor-cli-environments-always-carry.md) | completed |
