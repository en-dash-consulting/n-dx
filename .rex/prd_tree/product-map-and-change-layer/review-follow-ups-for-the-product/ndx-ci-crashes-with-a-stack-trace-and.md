---
id: "475f175a-f3de-4a25-97c3-1751dfe713fa"
level: "task"
title: "`ndx ci` crashes with a stack trace, and no report, when a scanned source file cannot be read"
status: "in_progress"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
startedAt: "2026-10-16T23:06:48.259Z"
acceptanceCriteria:
  - "With ci.restrictedImports configured and a source file the scan selects made unreadable (chmod 000, POSIX only), `ndx ci --format=json` exits 1 and prints parseable JSON whose architecture-policy step is not ok and whose violation names the file and the read error (test)"
  - "A readable project's architecture-policy step result is unchanged"
description: "Verdict: should-fix (from the adversarial review of 04e0520a, commit 843c1e00d).\n\nScenario: a project with ci.restrictedImports configured has a source file the scan selects but cannot read (chmod 000, a root-owned untracked file, or a file deleted by a concurrent build between the stat and the read). packages/core/ci.js scanRestrictedImports calls readFileSync with no guard (after `statSync(...)?.isFile()`), and runCI's `await checkRestrictedImports(dir)` (ci.js ~L295) does not catch, so `ndx ci` exits with an uncaught EACCES/ENOENT stack trace: no step summary, and `--format=json` prints no parseable JSON.\n\nBefore 843c1e00d the read was wrapped in try/catch and the file was skipped silently, which was a silent pass; 843c1e00d removed the catch deliberately but left the crash.\n\nReachable: `ndx ci` on any opted-in project with such a file. Rare (needs an unreadable source file or a race).\n\nOptions:\n1. Recommended: catch the read error and fail the step with a violation that names the file and the error (\"cannot read <file>: EACCES …\"). Loud, keeps the report and the JSON output. Needs describeViolation to take a read-error shape. Cheap.\n2. Skip unreadable files silently (pre-843c1e00d behaviour). Cheap, but an enforced rule passes unread."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T23:06:48.885Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
