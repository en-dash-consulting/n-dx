---
id: "51c28e57-4c40-41e6-8417-59975186204c"
type: "task"
title: "Java resolver misses the type in a method reference qualifier (Type::method)"
slug: "java-resolver-misses-the-type-in-a"
description: "G2 thingsboard scip-only edge: RedisTbTransactionalCache uses `.map(CacheSpecs::getTimeToLiveInMinutes)` with CacheSpecs in the same package (no import) and scip-java records a CacheSpecs# reference; the resolver emits no edge to CacheSpecs.java. Check whether the method_reference qualifier is captured by the Java queries. Single instance seen in the top targets; confirm against the other 1-count targets (TbContent, JsonTransportPayloadConfiguration, CalculatedFieldState, TbSubscriptionsInfo, AgentProfileService, AgentTemplateTestSupport, BaseController) which were not individually diagnosed."
priority: "low"
tags:
  - "sourcevision"
  - "java"
  - "g2"
---
