---
id: "468a2c2f-ab25-48a3-9d75-a85fe22ce178"
level: "task"
title: "scip-java comparison ignores constructor references and covers only PetClinic"
status: "pending"
priority: "low"
acceptanceCriteria: []
description: "From gate G2 (2026-10-08): packages/sourcevision/scripts/java-scip.mjs reduces a scip index to type-symbol (#) references only. A constructor call such as new PetValidator() is a #<init> method symbol in scip, so the real edge PetController -> PetValidator counted as a resolver false positive (precision 98.9% instead of 100%). Count constructor (#<init>) references as references to their type. Separately, G2 was measured on PetClinic alone (50 files); index junit-framework (Gradle, JDK 25 default) and, if it builds, thingsboard (large multi-module Maven) and record their numbers, so the G2 floors rest on more than one small repository. Indexing is an operator step (scip-java index --build-tool=<maven|gradle> --output index.scip)."
lastModified: "2026-10-08T04:18:38.862Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
