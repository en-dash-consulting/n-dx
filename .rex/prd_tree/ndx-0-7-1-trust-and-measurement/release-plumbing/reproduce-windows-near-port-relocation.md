---
id: "c4a2ef20-c78a-4c39-8cb1-35e47dd41cdd"
level: "task"
title: "Reproduce Windows near-port relocation never engaging (#367)"
status: "deferred"
priority: "low"
tags:
  - "0.7.1"
  - "web"
  - "windows"
  - "gh-367"
source: "Triage decision on GitHub issue #367 (2026-09-22): reproduction owned on a Windows 11 host (endash-shal) rather than accepting the 3117-3200 fallback"
acceptanceCriteria:
  - "The relocation path is exercised on a Windows host with a forced collision on 3117 and the observed behavior is recorded on issue #367."
  - "Either a failing regression test demonstrating the near-window path is skipped, or a comment on #367 with evidence the window engages, closing the issue."
description: "On Windows, hub peer relocation reportedly never uses its near-port window and silently degrades to the 3117-3200 fallback scan. Reproduce on a Windows 11 host: force a port collision on 3117, observe whether the near-window path is attempted, and capture logs. Outcome is either a confirmed defect with a failing test (then fix as a follow-up) or evidence the near window works and the issue report was mistaken (then close #367 with the evidence).\n\nNOTE (0.7.1 close-out, 2026-09-25): deferred past 0.7.1 by operator decision. The Windows 11 reproduction on endash-shal is still owned and does not block the cut; #367 stays open."
lastModified: "2026-09-25T16:46:27.141Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
