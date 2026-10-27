---
id: "5ae23c3d-ce4f-4145-853d-2d2bccb796de"
type: "change"
title: "Include Java in multi-language detection beside other build markers"
slug: "include-java-in-multi-language"
intent: "PR 3 adds Java to detection only when no other language marker matches, so existing detection results do not change. A Spring Boot service with a bundled frontend usually has package.json at the root as well as pom.xml or a Gradle build, so detectLanguages never returns Java for it and its .java files get no structure analysis once analyze runs packs.\n\nWhen analyze starts loading packs (task: Feed Java edges into the analyze pipeline), make detectLanguages include Java whenever a root pom.xml or Gradle build/settings file is present, alongside the other detected languages. Keep detectLanguage (single primary language) unchanged, so the primary language of mixed repositories does not move. Only repositories that contain a Maven or Gradle build may change, and only by gaining Java; output for repositories without one stays byte-identical."
acceptanceCriteria:
  - "detectLanguages includes Java when a root pom.xml or Gradle build or settings file sits beside other language markers"
  - "detectLanguage still returns the same primary language for every existing fixture"
  - "Repositories without a Maven or Gradle build produce byte-identical analysis output"
  - "A fixture with package.json and pom.xml at the root gets Java structure analysis for its .java files"
touches:
  - "f522e7ae-44aa-458b-80ef-7a1132416c0c"
priority: "medium"
tags:
  - "language-packs"
  - "phase-2"
  - "sourcevision"
  - "java"
source: "review"
blockedBy:
  - "cc902750-ded4-45eb-b726-5f159d8eca6e"
---
