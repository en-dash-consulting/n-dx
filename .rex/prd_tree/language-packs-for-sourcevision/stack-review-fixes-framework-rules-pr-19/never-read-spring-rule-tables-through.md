---
id: "69e3084c-5aea-4b98-8640-da1423bf3222"
level: "task"
title: "Never read Spring rule tables through the object prototype"
status: "in_progress"
priority: "high"
tags:
  - "review-fixes"
  - "lang-java"
  - "spring-boot"
  - "pr-19"
source: "review"
startedAt: "2026-10-17T08:27:17.171Z"
acceptanceCriteria:
  - "Calls like restTemplate.toString() and annotations named after Object.prototype members produce no facts"
  - "Every rule table in lang-java and lang-python framework rules is prototype-free"
  - "Spring facts golden unchanged; outbound.json from the fixture validates against the schema"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"The hench sandbox may block ~/.cache corpora; leave corpus checks to the session and do not capture follow-ups for them. Also look for the same pattern in the Python framework rule tables (lang-python fastapi/flask/django/python-clients) and fix it there too if present."}
description: "Stack review (#788, spring-boot.ts around line 455, lines 270/471/513 at the stack top). client.methods is a plain object (Object.fromEntries or a literal), so client.methods[\"toString\"] is Object.prototype.toString. The same goes for valueOf, constructor and hasOwnProperty. With a declared RestTemplate, KafkaTemplate, JmsTemplate or RabbitTemplate receiver, `restTemplate.toString()` runs `add(…, read(call.args), \"certain\")`. read returns \"[object Undefined]\", the spread turns it into keys \"0\"…\"17\", and the fact has no target or targetSource. packOutboundDependencies copies undefined, so the written outbound.json row fails OutboundDependencySchema, which requires both fields. LISTENERS[annotation.name] (around 497) and `a.name in MAPPING_METHODS` (around 258) share the root cause: an annotation named @constructor or @toString would match.\n\nFix: make every rule table prototype-free. Use Map, Object.create(null), or Object.hasOwn guards at every lookup. Look for the same pattern in the Python framework rule tables (fastapi, flask, django, python-clients) and fix it there too. As defence in depth, packOutboundDependencies (sourcevision pack-framework-facts.ts) could drop or reject a fact without target/targetSource rather than write an invalid row. Do this only if it stays small, and say so in the log.\n\nTests: a fixture where `restTemplate.toString()`, `kafkaTemplate.hashCode()` and `@toString`/`@constructor` annotations exist, giving no outbound facts or routes from them. An integration assertion that the written outbound.json validates against OutboundDependencySchema. The Spring facts golden must not change; the session checks the corpus."
lastModified: "2026-10-17T08:27:17.461Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
