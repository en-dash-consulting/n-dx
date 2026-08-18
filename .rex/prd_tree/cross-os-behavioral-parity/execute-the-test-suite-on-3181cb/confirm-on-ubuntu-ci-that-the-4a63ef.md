---
id: "4a63ef64-622d-40a5-b948-04dbd306d1f6"
level: "task"
title: "Confirm on ubuntu CI that the hench/web failures are Windows-specific as predicted"
status: "blocked"
priority: "medium"
tags:
  - "cross-os"
  - "ci"
  - "testing"
  - "verification"
  - "hench"
  - "web"
source: "exploration-2026-08-18"
acceptanceCriteria:
  - "The first CI run after the masking fix is read and its per-package pass/fail counts recorded for ubuntu"
  - "The prediction (hench green; web red only in graph-view's two cases) is explicitly confirmed or refuted"
  - "Any failure that contradicts the Windows-specific classification is traced to which of the triaged causes was misattributed"
  - "The classification in feature 214f5636 is corrected if the CI result disagrees with it"
  - "Any ubuntu-only failure with no Windows counterpart is recorded as a new category rather than folded into the existing groups"
description: "Split out of task 741bacf1, whose other criteria are met. That task asked whether the hench/web failures reproduce on ubuntu; both suites have now been triaged in full ON WINDOWS, which turns the open question into a falsifiable prediction. Reading the first CI run either confirms it or exposes something the analysis missed.\n\nWHY THIS CANNOT BE ANSWERED LOCALLY: no macOS or Linux machine is available to this setup, `gh` is not on PATH, and the branch carrying the masking fix is unpushed — so no CI run exists yet. Unblocking needs a human to push and open a PR, which is an outward-facing action.\n\nTHE PREDICTION, derived from the triage rather than guessed:\n\n  @n-dx/hench — expect GREEN on ubuntu (all 32 Windows-specific).\n    Every one traces to a failure mode that cannot occur on POSIX: drive-qualified `C:\\` paths,\n    `\\r\n` from core.autocrlf, EBUSY on rmdir (POSIX permits unlinking open files), cmd.exe not\n    stripping single quotes, and backslash path separators where node's join() yields forward\n    slashes on POSIX by construction.\n\n  @n-dx/web — expect exactly 2 FAILURES on ubuntu, both in\n    tests/unit/viewer/graph-view.test.ts (\"recenters the file street view when the focused graph\n    changes\" and \"supports back and forward through clicked dependency preview nodes\").\n    Those are jsdom's getBoundingClientRect returning 0x0 with no stub anywhere in\n    packages/web/tests, which is platform-independent. The other five (boundary-check x2,\n    routes-sourcevision x1, routes-hench-execute x2) are Windows-specific by the same reasoning as\n    hench's.\n\n  Note routes-hench-execute's pair is INTERMITTENT on Windows (2 of 3 runs), so its absence from a\n  single ubuntu run is weak evidence either way.\n\nWHAT TO DO WITH THE RESULT:\n- Matches the prediction: record the confirmation here and close. The Windows-specific classification in\n  feature 214f5636 is then evidence-backed rather than analytical, which matters because those fix tasks\n  are scoped on the assumption that production code is correct and only fixtures need changing.\n- Does NOT match: that is the more valuable outcome and needs care. A hench failure on ubuntu means at\n  least one of the 32 has a cause the triage misattributed — find which, and correct the classification\n  in 214f5636 before its fix tasks are worked, since a task that says \"fixture bug, production is fine\"\n  would send someone down the wrong path.\n- A failure on ubuntu that does NOT appear on Windows would be a third category nobody has looked for.\n\nRecord the ubuntu counts per package alongside the Windows figures already captured in 214f5636, so the\ntwo platforms can be compared directly rather than through prose."
---
