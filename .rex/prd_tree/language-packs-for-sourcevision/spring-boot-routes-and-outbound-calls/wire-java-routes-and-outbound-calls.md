---
id: "173347ff-5fdb-40f7-ab0c-0d9b0803dc47"
level: "task"
title: "Wire Java routes and outbound calls into serverRoutes and outbound.json"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "lang-java"
  - "spring-boot"
  - "sourcevision"
  - "pr-14"
blockedBy:
  - "24e2ec8b-215b-4074-bcaf-a4451a8e8ad4"
source: "roadmap"
acceptanceCriteria:
  - "Java routes appear in components.json serverRoutes as ServerRouteGroups, method-less routes recorded as GET with the Go detector's comment"
  - "Java outbound calls appear in outbound.json as OutboundDependency entries with confidence (inferred when the fact has none)"
  - "Each Java file is parsed once per analyze; pack facts reach the components and outbound phases without a second parse"
  - "Changes to outbound-detection.ts, server-route-detection.ts and components.ts are limited to named merge points listed in the task log"
  - "Snapshots byte-identical for non-Java repos and for Java repos without the Java pack; added-only on spring-petclinic and thingsboard with counts and samples logged; analyze-time delta on thingsboard logged"
  - "Root policy suites and sourcevision tests pass"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "Persist the Java pack's `routes` and `outboundCalls` facts (previous task) into the artifacts sourcevision already writes. No new artifact, no schema field removed or renamed.\n\n- Routes: the components phase's `serverRoutes` gains one `ServerRouteGroup` per Java file with routes (same shape the Express and Go detectors emit: file, prefix, handler, routes of {file, method, path, handler}). A RouteFact without a method is recorded as `GET`, with the same comment the Go detector (go-route-detection.ts) uses for method-less `http.HandleFunc`. Group order and route order follow the existing detectors' sort, so adding Java groups never reorders existing ones.\n- Outbound: `outbound.json` gains one `OutboundDependency` per OutboundCallFact (file, line from position, kind, target, targetSource, client, confidence; a fact without confidence records `inferred`). Sort and dedupe the same way existing entries are, so the TypeScript entries' order is unchanged.\n- Role filters: Java facts pass the same role filters the existing detectors apply. Outbound calls from files whose role is in outbound-detection.ts's `SKIP_ROLES` (test, docs, asset) are dropped, as for TypeScript; spring-petclinic's five RestTemplate calls are all under `src/test`, so its outbound.json is expected to gain nothing. Routes from files with role test, config or docs are dropped (the role check in server-route-detection.ts's `isLikelyRouteFile`), but not its path heuristics: for Java the `@RestController`/`@Controller` annotation is the evidence. Reuse the existing role sets rather than copying them.\n- One parse per analyze: the Java pack already parses every Java file for imports. Ask the pack for imports, routes and outboundCalls in that single call and hand the routes and outbound facts to the components and outbound phases (cache them on the analyze run, the way pack import facts already reach the imports phase); never parse a Java file twice. If the components or outbound phase runs alone (`--phase`), it may call the pack itself for just those kinds. The pack entry's `notices` (skipped non-literal mapping paths) go wherever pack notices already surface; do not add a new artifact for them.\n- Merge points only: outbound-detection.ts, server-route-detection.ts and components.ts are Sterling H's files. Change them only where Java facts are merged in, keep each change small and named (a single function call or a single merge function), and record the exact merge points in this task's log for his review.\n- Pack absent: with no Java pack installed, or for a repository without Java, nothing changes. Byte-identical output is required for every repository without Java, and for Java repositories analyzed without the Java pack.\n\nVerification (record in this task's log):\n- `sv analyze --fast` snapshots byte-identical to PR 13's tip for microservices-demo, workspace-crossings, terraform-aws-rds and sourcevision's own tree; petclinic identical with the Java pack removed.\n- With the Java pack: spring-petclinic and thingsboard components.json and outbound.json differ only by added Java route groups and outbound entries (an added-only check like scratchpad infra-added-only.mjs); report counts per kind and client and a hand-checked 15-entry sample of each. Task 1's corpus report gives the pre-filter numbers: petclinic 17 routes / 5 outbound (all test), thingsboard 894 routes / 617 outbound.\n- Java corpus clean-parse numbers unchanged; analyze wall-clock on thingsboard with and without the change (delta reported, expected small since nothing is parsed again).\n- Root policy suites and sourcevision tests pass."
lastModified: "2026-10-15T21:22:28.231Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
