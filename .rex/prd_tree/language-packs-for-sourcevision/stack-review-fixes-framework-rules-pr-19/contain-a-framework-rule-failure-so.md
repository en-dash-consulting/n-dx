---
id: "0635e6f9-c312-4f30-9f1f-1fd62817ef86"
level: "task"
title: "Contain a framework rule failure so the language's imports survive"
status: "pending"
priority: "high"
tags:
  - "review-fixes"
  - "lang-runtime"
  - "pr-19"
source: "review"
acceptanceCriteria:
  - "A framework whose read throws yields empty facts for that framework plus a notice naming it; imports and other frameworks' facts are unaffected"
  - "The pack is not degraded by a framework failure; test covers it"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"The hench sandbox may block ~/.cache corpora; leave corpus checks to the session and do not capture follow-ups for them."}
description: "Stack review (#788, lang-runtime pack-entry.ts around line 126, line 143 at the stack top). f.read(...) runs inside analyzeProject's try … finally with no catch. If readSpringFile, or any FastAPI/Flask/Django/python-clients rule, throws on a single file, analyzeProject rejects. buildPackImportGraph then degrades the pack with \"the pack failed … Reinstall it\". That run loses every import edge for the language, and the user is pointed at a reinstall that won't help. The imports phase now runs framework rules on every Java and Python analyze, so the blast radius is the whole language. No realistic input throws today.\n\nFix: wrap each framework's read in a try/catch inside pack-entry. On failure, return empty facts for that framework plus a notice, e.g. \"Spring Boot rules failed: <message>; routes and outbound calls were not recorded\". Imports, symbols and other frameworks' facts survive. Include the framework id in the notice. A test uses a framework whose read throws on one file and asserts that imports and the other frameworks' facts come back, plus the notice. Byte-identical output on the corpus; the session checks."
lastModified: "2026-10-17T08:27:05.419Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
