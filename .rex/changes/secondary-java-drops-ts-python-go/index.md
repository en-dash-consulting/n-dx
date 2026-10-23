---
id: "9ac16e77-6429-4b27-b0f1-f0711f1783cf"
type: "change"
title: "Secondary Java drops TS/Python/Go files under out/ and generated/ from a mixed repo's inventory"
slug: "secondary-java-drops-ts-python-go"
intent: "Verdict: should-fix (medium). This was introduced by \"Include Java in multi-language detection beside other build markers\" (5ae23c3d).\n\nScenario: take a repo with package.json and pom.xml at the root and an OpenAPI-generated TS client at frontend/src/generated/api.ts (or TS under out/ or target/). detectLanguages now returns [typescript, java]. mergeLanguageConfigs unions skipDirectories, so Java's target/, out/, .gradle/, generated-sources/ and generated/ (packages/sourcevision/src/language/java.ts) now skip those TS files at inventory time. It also unions generatedFilePatterns, so any TS file under generated/ that is reached is classified as generated. Before this change those files were inventoried and their import edges were kept. The task's claim was that mixed repos change \"only by gaining Java\", and that claim does not hold.\n\nReachable: the analyze inventory phase (analyze-phases.ts calls detectLanguages, then mergeLanguageConfigs, then analyzeInventory) on a Spring Boot repo with a bundled frontend. That is exactly the shape the task targets. Repos without a Maven or Gradle file are unaffected.\n\nOptions:\n1. When Java is secondary, merge only its extensions, parseable, test, config and entry patterns, and not skipDirectories or generatedFilePatterns. This could be a flag on LanguageConfig (for example `primaryOnly` skip dirs), or detectLanguages could return a trimmed javaSecondaryConfig. Cheap. The risk is that Maven target/ output would no longer be skipped in mixed repos; .class files are not inventoried and target/ rarely holds .java, so the risk is low.\n2. Scope Java's skip and generated rules to .java files (per-extension skip). This is more invasive to the inventory walk.\n3. Accept the behaviour and document it, on the view that skipping generated code is desirable. That needs an explicit decision because it contradicts the epic rule that TS/JS output must not change.\nRecommendation: option 1, keeping `target` and `.gradle` in the secondary set because they are unambiguous build output."
acceptanceCriteria:
  - "A repo with package.json + pom.xml and a TS file under generated/ or out/ keeps that file in the inventory with its normal role"
  - "TS import edges into and out of such files are unchanged versus the same repo without pom.xml"
  - "A unit or integration test covers the package.json + pom.xml + generated/*.ts case and fails on the current merge behaviour"
  - "Java-primary repos still skip target/, build/, out/, .gradle/, generated-sources/ and generated/"
touches:
  - "f522e7ae-44aa-458b-80ef-7a1132416c0c"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "language-packs"
  - "sourcevision"
  - "java"
source: "ndx-adversarial-review"
---
