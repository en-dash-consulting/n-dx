---
id: "cc902750-ded4-45eb-b726-5f159d8eca6e"
type: "change"
title: "Feed Java edges into the analyze pipeline"
slug: "feed-java-edges-into-the-analyze"
intent: "Route Java files through the pack runner and resolver in the imports phase, the way Go and Swift files go through their parsers today, producing the existing ImportEdge and ExternalImport records. Zones, cohesion, coupling, risk and findings then work for Java without changes downstream. Add a small fixture Spring Boot-style repository (controller, service, repository and entity packages, written for the fixture) and check that analyze produces sensible zones for it.\n\nDo not change sourcevision MCP tool names, parameters or response shapes, and do not add committed paths. If the Java grammar is not built, Java falls back to inventory-only with one clear message."
acceptanceCriteria:
  - "sv analyze on a Java fixture repository writes import edges and external imports for Java files"
  - "Zones are produced for the fixture Spring Boot-style repository"
  - "Without the built grammar, Java is inventory-only with a single message and analysis succeeds"
  - "Analysis output and sourcevision evals for non-Java repositories are unchanged"
  - "sourcevision MCP tool shapes are unchanged"
touches:
  - "f522e7ae-44aa-458b-80ef-7a1132416c0c"
priority: "medium"
tags:
  - "language-packs"
  - "phase-2"
  - "sourcevision"
  - "java"
source: "roadmap"
blockedBy:
  - "e511c022-e759-4c42-bdb6-4951059e4ff8"
---
