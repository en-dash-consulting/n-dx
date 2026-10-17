---
id: "7746751b-45d3-4ec2-9cd2-08a7773395d1"
level: "task"
title: "Read Groovy Gradle statements that continue after a trailing comma"
status: "pending"
priority: "medium"
tags:
  - "review-fixes"
  - "lang-kit"
  - "pr-18"
source: "review"
acceptanceCriteria:
  - "A Groovy dependency statement continued after a trailing comma is read as one statement"
  - "Multi-line map-style and multi-coordinate fixtures pass; no false 'computed group or name' notice"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"The hench sandbox may block ~/.cache corpora; leave corpus checks to the session and do not capture follow-ups for them."}
description: "Stack review (#764, gradle-script.ts around line 118, packages/lang-kit/src/gradle-script.ts at the stack top). A newline at depth 0 ends a statement unless the next line starts with `.`. But Groovy also continues a statement after a trailing comma, and this form is common:\n\n```groovy\nimplementation group: 'com.google.guava',\n    name: 'guava', version: '33.0.0-jre'\n```\n\nThe first half has group and no name, so it produces `has a computed group or name` and []. The second half is rejected outright, so Guava is silently lost. The same happens to `implementation 'a:b:1',\\n  'c:d:2'`, where the second coordinate is dropped.\n\nFix: don't end a statement at a newline when the last non-blank masked character before it is `,` (ideally also a binary operator). Add multi-line map-style and multi-coordinate fixtures. Expected change: the Java corpus report's Gradle dependency counts may grow where repos use the form; the session checks."
lastModified: "2026-10-17T06:55:46.824Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
