---
id: "b0de7e5c-2cdb-4b42-b13b-882271578ab8"
type: "task"
title: "Make pom.xml reading linear and bounded"
slug: "make-pom-xml-reading-linear-and-bounded"
description: "Stack review (#763, java-modules.ts around line 103; packages/lang-kit/src/java-modules.ts at the stack top), a latent public lang-kit export now used by PR 17/18 code. `<${tag}>\\s*([^<]*?)\\s*</${tag}>` backtracks between `\\s*` and `[^<]*?` when the closing tag is missing: `<sourceDirectory>` followed by 2,000 spaces took 1.7 s in Node 22, and the cost grows steeply. stripXmlComments (around line 62) is also quadratic on an unterminated `<!--`.\n\nFix:\n- use `<tag>([^<]*)</tag>` and `.trim()` in JS;\n- strip comments with indexOf and stop at an unterminated `<!--` (keep the CodeQL-safe fixpoint behaviour from the earlier fix);\n- cap the size of build files read, with a notice when a file is skipped for size.\n\nApply the same to any other pom/XML reader regex in lang-kit (xml-lite, java-maven-build) with the same shape. Tests: pathological inputs (a missing closing tag with long whitespace, an unterminated comment) return promptly. The Java corpus report and build-model output are unchanged; the session checks."
acceptanceCriteria:
  - "Tag extraction and comment stripping are linear; pathological pom content returns promptly"
  - "Build files over a size cap are skipped with a notice"
  - "Java corpus report and build-model output unchanged"
priority: "medium"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"The hench sandbox may block ~/.cache corpora; leave corpus checks to the session and do not capture follow-ups for them."}
tags:
  - "review-fixes"
  - "security"
  - "lang-kit"
  - "pr-20"
source: "review"
---
