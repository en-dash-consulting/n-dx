---
id: "268f39f3-dbd5-4397-9774-f1e0f6ffa0ec"
type: "task"
title: "Decode hand-written frontmatter escapes in one pass and make the rex store regexes linear"
slug: "decode-hand-written-frontmatter"
description: "Layer 3 of the CodeQL stack (docs/process/codeql-triage-2026-10.md, Layer 3). CodeQL alerts 31 (js/double-escaping), 18, 20, 21, 22 (js/polynomial-redos) and 34 (js/incomplete-sanitization). folder-tree-parser.ts line 1376 decodes a double-quoted scalar that is not valid JSON with a four-step replace chain, so an escaped backslash followed by n becomes a newline; reproduced against the built dist and it compounds on every save. Replace the chain with one single-pass decoder. Quadratic regexes measured on 50k-character inputs: extract.ts 647 trailing-punctuation trim (474 ms), markdown-parser.ts 548 and 552 block-scalar chomping (476 ms) plus its unflagged twin at folder-tree-parser.ts 1347 and 1350, markdown-serializer.ts 364 LOOKS_LIKE_NUMBER_RE (2.5 s). Replacements are behaviour-identical; see the document. Also delete web's unused savePRDSync import in routes-rex/rex-route-helpers.ts and escape backslashes before pipes in folder-tree-index-generator.ts (no production caller). Branch fix/rex-frontmatter-decode-and-linear-regexes."
acceptanceCriteria:
  - "A hand-written non-JSON quoted scalar holding an escaped backslash before n reads back with a literal backslash, and the existing escape cases still pass"
  - "extractRequirementSentences, applyChomping in both parsers, and mustQuoteYamlString finish within the callWithinBudget budget on 100k-character adversarial inputs with unchanged results"
  - "Numeric-looking strings 42, 1.5, .5, 1e5 and -3 are quoted and 1.2.3 is not"
  - "Patch changesets for @n-dx/rex and @n-dx/web"
priority: "high"
source: "codeql-triage"
---
