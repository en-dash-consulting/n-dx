---
id: "2147717e-b3b7-44b8-be38-bba001a14bc6"
level: "feature"
title: "Spring Boot routes and outbound calls through the Java pack (PR 14)"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "lang-java"
  - "spring-boot"
  - "outbound"
  - "sourcevision"
  - "side-stack"
  - "pr-14"
blockedBy:
  - "05b34c7e-bd74-4bd4-8e40-d511a8b8f22d"
source: "roadmap"
acceptanceCriteria:
  - "The Java pack's entry produces routes and outboundCalls facts for Spring Boot code, and lang-kit lists both as produced"
  - "A Spring repo analysed with the Java pack gets its routes in components.json serverRoutes and its outbound calls in outbound.json"
  - "Every repo without Java, and Java repos without the Java pack, analyse byte-identically to PR 13"
  - "The Java corpus report's clean-parse numbers are unchanged"
  - "The root policy suites pass"
description: "\"Java with Spring Boot is the first pack\" (2026-10-07) and step 8 of the order agreed with Sterling H: framework rules feeding outbound.json. The stack (PR 1–13, #760–#772, #780) gave Java structure, resolution and build files; the pack contract (PR 11) declared `routes` and `outboundCalls` so a pack fills them without a contract change, and nothing produces them yet. This feature proves those shapes with a Spring Boot module in @n-dx/lang-java. Stacked on PR 13 because the stack is low on the merge list. Brief: workshop analysis/language-scaling/pr14-spring-boot-brief.md.\n\nDecisions (design pass, 2026-10-15):\n- Facts land in existing artifacts only (decision 3): routes join the components phase's `serverRoutes` (ServerRouteGroup per file, the shape the Express and Go detectors emit); outbound calls join `outbound.json` (OutboundDependency: file, line, kind, target, targetSource, client, confidence). No new artifact, no schema change in sourcevision.\n- Contract, additive: lang-kit's OutboundCallFact gains optional `confidence` (`certain | likely | inferred`, sourcevision's Confidence). RouteFact.method stays optional (absent = any method); the engine records it as `GET`, the convention go-route-detection.ts already uses for http.HandleFunc, with the same comment.\n- Producers and consumers both count as queue dependencies, as Hal's kafkajs rule in outbound-detection.ts does (`send` and `subscribe`).\n- Spring placeholders (`\"${orders.url}\"`) are targetSource `config` with the key as target; values are not resolved.\n- Out of scope: WebFlux RouterFunctions, JAX-RS, Spring Cloud Gateway, database and cache clients (database-engines covers engines).\n\nRules for every task: the stack's rules hold (no pack imports another pack; no package.json dependency changes, agents cannot run pnpm install; do not touch rex, hench, core or web source; no language SDK at run time). outbound-detection.ts, server-route-detection.ts and components.ts are Sterling H's files: change only the merge points, keep every existing detector's output identical. New guidance goes in package AGENTS.md files (the root AGENTS.md chain has ~119 bytes of headroom).\n\nThe bar: byte-identical analysis output for every repo without Java and for Java repos without the Java pack; the Java corpus report's clean-parse numbers unchanged; on spring-petclinic and thingsboard, route and outbound counts reported with a hand-checked sample. Gates after every task (rebuild first): lang-java, lang-kit, lang-runtime and sourcevision suites (SV_REQUIRE_GRAMMARS=1 is run by the operator); the root policy suites (architecture-policy, domain-isolation, instruction-alignment, layout-literal-policy, agents-md-size-budget, vitest-hidden-spawn-policy, prd-line-endings, ci-merge-queue-trigger, iso-skill-drift, shell-spawn-inventory-policy, wall-clock-inventory-policy, obfuscated-code-policy).\n\nSide stack, PR 14, cut from PR 13's tip 2ba370d13."
lastModified: "2026-10-15T20:40:19.495Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Spring Boot module in @n-dx/lang-java: routes and outbound call facts](./spring-boot-module-in-n-dx-lang-java.md) | in_progress |
| [Wire Java routes and outbound calls into serverRoutes and outbound.json](./wire-java-routes-and-outbound-calls.md) | pending |
