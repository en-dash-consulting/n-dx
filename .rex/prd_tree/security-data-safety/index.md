---
id: "9e34fc07-ee34-4483-b38f-85be499fdd4a"
level: "epic"
title: "Security & Data Safety"
status: "pending"
priority: "critical"
tags:
  - "security"
  - "ndx-adversarial-review"
source: "ndx-adversarial-review"
description: "Cross-package epic for defects that can leak a user's secrets or project content, or let untrusted input (repo content, prompt injection, a web page open alongside the dashboard) execute or exfiltrate on a user's machine when they run n-dx against their own repository. Groups findings from adversarial security reviews so they are visible as a class rather than scattered under per-package epics.\n\nThreat model assumed by items here: n-dx runs on a developer's machine against a repo they may not fully trust (cloned, forked, or with a PR checked out); the dashboard (`ndx start`) is loopback-only but shares a browser with arbitrary websites; hench may run autonomously (`--auto`) against repo content that can carry prompt injection; anything under `.rex/`, `.hench/`, `.n-dx.json` may end up in `git add -A`."
lastModified: "2026-09-11T17:36:02.689Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Adversarial security review 2026-09-11 — findings](./adversarial-security-review-2026-09-11/index.md) | pending |
| [`/api/hench/adaptive/override` and `/apply` write arbitrary keys into `.hench/config.json`](./api-hench-adaptive-override-and-apply.md) | pending |
