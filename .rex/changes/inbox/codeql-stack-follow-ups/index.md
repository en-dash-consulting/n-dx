---
id: "e59363f1-df60-4a4a-8045-e4419c5c3478"
type: "change"
title: "CodeQL stack follow-ups"
slug: "codeql-stack-follow-ups"
intent: "Pre-existing defects the eight adversarial reviews of the CodeQL stack (#846 to #854) surfaced and that no layer owned. Each layer fixed what the review found against its own code; these are the survivors, fixed together in one layer on top of the stack so it merges last. Full reasoning per item: the review reports summarised in docs/process/codeql-triage-2026-10.md's follow-up section. Decisions that are not code (claude_commands.log scope, shell-string spawns bypassing the Windows guard by design, repo-trust fingerprinting of llm.*.model, the 4 KB classifier window) are listed in the description of this feature for Ryan, not as tasks."
acceptanceCriteria:
  - "Every task below is closed by a commit on the top layer of stack #855 carrying its N-DX-Item trailer, with a test that fails before the fix"
priority: "medium"
source: "codeql-triage"
---
