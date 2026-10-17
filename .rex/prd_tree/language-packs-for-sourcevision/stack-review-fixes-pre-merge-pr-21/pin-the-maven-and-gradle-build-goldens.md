---
id: "3f57f754-ef12-4323-9840-8e1a756f2863"
level: "task"
title: "Pin the Maven and Gradle build goldens to LF so Windows checkouts match"
status: "pending"
priority: "high"
tags:
  - "review-fixes"
  - "windows"
  - "ci"
  - "sourcevision"
  - "pr-21"
source: "review"
acceptanceCriteria:
  - "packages/sourcevision/tests/fixtures/maven-build/** and gradle-build/** are checked out LF under core.autocrlf=true (pinned in .gitattributes, or the test normalises line endings before comparing)"
  - "The six golden tests in java-maven-build.test.ts and java-gradle-build.test.ts pass in Tests (Windows, rex+sourcevision)"
  - "git add --renormalize on the pinned paths produces no content change (the index is already LF)"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "**should-fix; required check Tests (Windows, rex+sourcevision), run 39028377207.** Review: https://github.com/en-dash-consulting/n-dx/pull/825#pullrequestreview-5559040931 (CI section, \"CRLF goldens\").\n\nAt the #825 head, the goldens under `packages/sourcevision/tests/fixtures/maven-build/{bom-import,external-parent,parent-child}/golden.json` and `packages/sourcevision/tests/fixtures/gradle-build/{computed,groovy-multi,kotlin-catalog}/golden.json` (from #764) are checked out with CRLF on Windows (core.autocrlf=true). The six golden tests in `packages/sourcevision/tests/unit/language/java-maven-build.test.ts` and `java-gradle-build.test.ts` compare the serialised `\\n` output against `\\r\\n` file content and fail.\n\n`.gitattributes` already pins `packages/lang-*/tests/fixtures/**` and `packages/sourcevision/tests/fixtures/sdlc/**` to `text eol=lf` for exactly this reason, but not these two sourcevision fixture trees.\n\nFix (preferred): add `packages/sourcevision/tests/fixtures/maven-build/** text eol=lf` and `packages/sourcevision/tests/fixtures/gradle-build/** text eol=lf` beside the sdlc pin, with a one-line comment in the existing style. Pin the whole fixture tree, not only golden.json, since captured positions depend on the build files' line endings too. Alternative: normalise `\\r\\n` to `\\n` in the tests' golden read. Do not touch tests/e2e/prd-line-endings.test.js's injector section (these lines go in the repo-only section below its marker)."
lastModified: "2026-10-17T17:31:32.420Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
