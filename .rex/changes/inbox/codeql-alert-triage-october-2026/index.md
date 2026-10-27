---
id: "98fe5cc3-1d8a-47dc-846b-90a756868693"
type: "change"
title: "CodeQL alert triage, October 2026"
slug: "codeql-alert-triage-october-2026"
intent: "Triage of the 58 open javascript-typescript CodeQL alerts on main at 0a7c21477 and the nine-layer stack that closes them. Ten are true positives: a bypass of the #790 cmd.exe %VAR% guard reachable from a committed PRD model pin (alerts 69, 71, 44, 51), a prototype write through the LLM config route's delete path (59), a double-unescape in frontmatter decoding (31), and three cubic regexes on provider error bodies (8, 9, 14, 17). Twenty-six get cheap defensive fixes; twenty-two are dismissed with a reason. Verdicts, measurements, per-layer fixes, tests and dismissal comments: docs/process/codeql-triage-2026-10.md. Alerts: https://github.com/en-dash-consulting/n-dx/security/code-scanning"
acceptanceCriteria:
  - "Every one of the 58 open alerts is either closed by a merged layer or dismissed in GitHub with the comment from the triage document"
  - "No layer merges without its PRD task's N-DX-Item trailer, a patch changeset per touched package, and the tests named in the triage document"
priority: "critical"
source: "codeql-triage"
---
