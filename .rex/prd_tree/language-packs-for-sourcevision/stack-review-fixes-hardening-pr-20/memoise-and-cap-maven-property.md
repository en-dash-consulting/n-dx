---
id: "ab502e66-d19f-4cf0-8986-bb98e16e09c9"
level: "task"
title: "Memoise and cap Maven property interpolation"
status: "completed"
priority: "medium"
tags:
  - "review-fixes"
  - "security"
  - "lang-kit"
  - "pr-20"
source: "review"
startedAt: "2026-10-17T09:42:18.781Z"
completedAt: "2026-10-17T09:54:58.729Z"
endedAt: "2026-10-17T09:54:58.729Z"
resolutionType: "code-change"
resolutionDetail: "Per-context cache of resolved properties plus a 4096-char expansion cap in java-maven-build.ts interpolate; commit 3ff3de131."
acceptanceCriteria:
  - "Property interpolation is memoised per context; a doubling chain at N=30 returns promptly"
  - "Expansions over the cap resolve to { resolved: false, reason: 'property expansion too large' }"
  - "Existing Maven fixtures and corpus build output unchanged"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"The hench sandbox may block ~/.cache corpora; leave corpus checks to the session and do not capture follow-ups for them."}
description: "Stack review (#764, packages/lang-kit/src/java-maven-build.ts around line 379). Each `${name}` is expanded by recursing into the property's raw value with no memoisation; `seen` stops cycles, not repeated expansion. Take a pom whose properties are `a0=${a1}${a1}`, `a1=${a2}${a2}`, …, `aN=x`, with `<version>${a0}</version>`: it costs 2^N calls and builds a 2^N-character string. Measured: a 456-byte pom with N=16 takes 0.4 s, a 548-byte pom with N=20 takes 5.2 s, and N=26 was still running after 2 minutes. It also runs several times per pom (group, version, each dependency, Java version).\n\nFix: memoise resolved properties per context (Map<name, BuildValue>) and cap the expanded length, e.g. at 4 KB, giving `{ resolved: false, reason: \"property expansion too large\" }`. Tests: the doubling chain at N=30 returns promptly with the cap reason; ordinary interpolation fixtures are unchanged; the Java corpus build output is unchanged."
lastModified: "2026-10-17T09:54:59.045Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
