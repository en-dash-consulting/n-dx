---
id: "6bead559-763e-4482-9c5c-ec99bd42fe46"
type: "task"
title: "Java resolver misses a type nested in an inherited supertype when used by simple name"
slug: "java-resolver-misses-a-type-nested-in"
description: "G2 thingsboard scip-only edges (24 of 37): a file uses a nested type (or its constructor) of a supertype it inherits from, by simple name, without importing the outer type. Examples: BaseTbResourceServiceTest extends AbstractControllerTest (extends AbstractWebTest) uses AbstractWebTest.IdComparator (18 edges into AbstractWebTest.java); TbMsgAttributesNode uses OnEveryMessage/Deduplicate/WebSocketsOnly nested in ProcessingSettings, inherited via AttributesProcessingSettings extends ProcessingSettings (6 edges). Resolver should follow the extends/implements chain when resolving a simple name. Measure with node packages/sourcevision/scripts/java-scip-compare.mjs."
priority: "low"
tags:
  - "sourcevision"
  - "java"
  - "g2"
---
