---
id: "db8daffc-a3de-4393-831f-680407a07afe"
type: "change"
title: "llm-client's getCurrentBranch opens a console window on Windows"
slug: "llm-client-s-getcurrentbranch-opens-a"
intent: "packages/llm-client/src/exec.ts `getCurrentBranch` (~791) calls `execFileSync(\"git\", [\"rev-parse\",\"--abbrev-ref\",\"HEAD\"], …)` without `windowsHide: true`; its siblings getCurrentHead (~662) and gitRevParsePath (~826) have it. Called from a parent with no console (the hub, the background dashboard), git flashes a visible console window.\n\nReachable: yes, on Windows.\n\nFix options: (1, recommended) add `windowsHide: true`; one line. scripts/lib/windows-hide-scan.mjs could also flag it.\n\nVerdict: out-of-scope for the streamline refactor stack (pre-existing, found by its adversarial review, 2026-11-15); worth fixing on its own."
acceptanceCriteria:
  - "getCurrentBranch passes windowsHide: true"
  - "The windows-hide scan (or a unit test) flags an execFileSync git call without windowsHide in exec.ts"
priority: "low"
source: "ndx-adversarial-review"
---
