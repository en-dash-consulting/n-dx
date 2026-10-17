---
id: "144cf782-2f21-493b-bbcb-dbb29a06dccc"
level: "task"
title: "Java entry points are guessed from file names, not detected from public static void main"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "java"
  - "language-packs"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A Java class declaring public static void main in a file not named *Application.java or Main.java is reported as an entry point"
  - "A class named FooApplication.java without a main method is not reported as an entry point"
  - "A golden or unit test covers both cases"
description: "Verdict: should-fix (severity low). The Java LanguageConfig (packages/sourcevision/src/language/java.ts, entryPointPatterns) uses path heuristics (*Application.java, Main.java) because entryPointPatterns are path-only regexes. The task spec said entry points are \"classes with a public static void main\". Scenario: a CLI tool whose main class is com/acme/tool/Launcher.java is not an entry point; a non-runnable class named FooApplication.java is. Reachability: entryPointPatterns is not read by any analyzer today (grep src/ outside language/), so there is no wrong output yet; it becomes wrong once a consumer reads it. Options: (1, recommended) when the Java structure queries land, emit main-method declarations as entry points from the method query and use them in place of the name heuristic; cost is one query capture and a golden, no risk to other languages. (2) Read file content in a content-aware entry-point hook on LanguageConfig; wider contract change across all languages."
lastModified: "2026-10-08T01:41:51.434Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
