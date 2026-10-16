---
id: "77faf76b-4e8e-46cd-acbd-847f3a0af05f"
level: "task"
title: "Spring Boot's byOwner pairs captures by scanning every owner, quadratic in a large Java file"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "lang-java"
  - "performance"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "readSpringFile on a generated Java file with 8,000 calls in one method takes no more than 2x the Java pack's own capture time (measured, numbers logged)"
  - "spring-boot.ts has no per-capture scan of all owners (byOwner uses innermostEach) and callAt/chainedOn use position lookups"
  - "tests/fixtures/spring-boot/facts.json and the Java golden are unchanged"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Take option 1, using lang-runtime's innermostEach from PR 16. Spring Boot's facts must not change: tests/fixtures/spring-boot/facts.json, the Java golden, and (verified by the session) spring-corpus-report.mjs and every Java repo's components.json and outbound.json stay byte-identical. Measure with a generated 8,000-call Java file and log before and after. Ship as one commit on feat/sv-lang-pr16b-spring-perf with a @n-dx/lang-java patch changeset. The hench sandbox may block ~/.cache/ndx-java-corpus. If it does, leave the corpus run to the session, which verifies it; do not capture follow-ups for it."}
description: "Verdict: out-of-scope (medium), pre-existing since PR 14. The adversarial review of e589b220 found it while fixing the same shape in lang-python.\n\nScenario: a Java file with thousands of method calls, or annotation values, in a repository analysed with the Java pack (analyze asks for imports+routes+outboundCalls, so Spring's rules run on every Java file). byOwner calls `innermost(owners, c)` for every captured node (packages/lang-java/src/spring-boot.ts:92), a scan of every owner, so pairing arguments with argument lists costs n x m. On the equivalent Python file (8,000 calls), the same scan pattern in lang-runtime's callSites took about 0.9 s at 4,000 calls and grew quadratically. The review replaced that pattern there with a sweep.\n\nReachable: `sv analyze` on any repository with the Java pack, through readSpringFile → readAnnotations/readOutbound → byOwner. The callers' `calls.find(...)` scans in readOutbound (callAt, chainedOn) are also linear per call.\n\nOptions:\n1. (Recommended) Build byOwner on lang-runtime's innermostEach (added by e589b220's review; one sweep, n log n). For callAt and chainedOn, use a Map keyed by span. Cost: small. Risk: the Spring facts golden pins the behaviour.\n2. Leave it until a corpus timing shows it matters. The Java corpus report could time readSpringFile per file."
lastModified: "2026-10-16T04:00:17.623Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
