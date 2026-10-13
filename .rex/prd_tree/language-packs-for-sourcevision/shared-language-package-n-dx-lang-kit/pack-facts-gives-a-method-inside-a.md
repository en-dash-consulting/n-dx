---
id: "a3c71293-a6a1-457e-9106-1438becad576"
level: "task"
title: "pack-facts gives a method inside a Java anonymous class the enclosing named class as its container"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-kit"
  - "pack-contract"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A pack-facts test with a method inside a Java anonymous class asserts that the method's container is not the enclosing named class (absent, or whatever option 2 documents)"
  - "SymbolFact.container's doc in lang-kit pack-contract.ts states the rule for members of anonymous classes"
  - "The Java language-pack goldens stay unedited"
description: "Verdict: should-fix (low). Found by the adversarial review of 8fab5dc4.\n\nScenario: `class Clinic { void start() { new Thread(new Runnable() { public void run() {} }); } }`. The Java declarations query (queries/java/declarations.scm) captures only named type declarations, so an anonymous class body is never a symbol. In packages/sourcevision/src/language/pack-facts.ts, readSymbols (the \"nearest enclosing type\" pass at the end) therefore gives `run` the container \"Clinic\". The contract in packages/lang-kit/src/pack-contract.ts (SymbolFact.container) reads as \"the type a member belongs to\", and `run` is not a member of Clinic. A method in an enum constant body gets the enum as its container in the same way, which is arguably fine.\n\nReachable: no consumer reads symbols facts today; only tests call readSymbols. PR 12/13 consumers would act on the wrong container.\n\nOptions:\n1. (Recommended) Also capture anonymous class bodies (object_creation_expression class_body) as a container boundary in pack-facts, and leave `container` absent for members whose innermost enclosing body is anonymous. Cost: one query capture plus a containment check. Risk: the query edit must keep the Java goldens byte-identical, or the capture must go in a separate query.\n2. Document in SymbolFact.container that a Java member of an anonymous or local class takes the nearest named enclosing type. Cost: one comment. Risk: consumers have to know about it."
lastModified: "2026-10-13T04:29:32.140Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
