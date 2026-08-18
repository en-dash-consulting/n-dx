---
id: "30235fba-a44c-493e-b58a-33a9f86e5743"
level: "task"
title: "Fix the hardcoded \"/\" after join() in web's boundary-check exemptions"
status: "pending"
priority: "high"
tags:
  - "cross-os"
  - "windows"
  - "testing"
  - "web"
  - "paths"
  - "architecture"
source: "exploration-2026-08-18"
acceptanceCriteria:
  - "Both currently-failing boundary-check assertions pass on Windows"
  - "All nine join()+\"/\" sites are corrected, not just the two that surface today"
  - "A single shared normalization helper is used rather than nine independent edits"
  - "The documented crash/ and messaging/ bypasses are still exempted — verified by confirming the suite passes WITHOUT changing any production import"
  - "The tests still pass on POSIX"
  - "No exemption was widened to make the failure disappear — the rules still catch a genuine violation (verify by temporarily adding one)"
description: "packages/web/tests/integration/boundary-check.test.ts builds exemption prefixes with join() and then appends a FORWARD slash:\n\n    const isCrash = rel.startsWith(join(\"viewer\", \"crash\") + \"/\") || rel === join(\"viewer\", \"crash\");\n\nOn Windows join() yields \"viewer\\crash\", so the expression becomes \"viewer\\crash/\" — which never matches\nrel \"viewer\\crash\\crash-detector.ts\". The segments were made portable; the separator was not.\n\nNINE OCCURRENCES of the pattern: lines 119, 125, 176, 294, 369, 372, 633, 689, 800. Two currently surface\nas failures (\"viewer cross-boundary imports flow through external.ts gateway\" and \"shared/ consumers\nimport through barrel, not leaf files\"); the rest are latent because the files they would exempt happen\nnot to have the imports in question.\n\nFAILURE DIRECTION — checked, not assumed. All nine are exemption-side (`continue` / `!isCrash`), so a\nnon-match makes the check RUN where it should have been skipped: a false POSITIVE. Line 176 was inspected\nspecifically because it builds a `zonePrefix` that could have been detection-side, which would instead\nmean a governance rule silently unenforced on Windows — it is used at line 179 as an exemption, so no rule\ngoes unchecked.\n\nWHY THIS IS WORSE THAN NOISE. The import it flags is a bypass CLAUDE.md documents as deliberate: \"crash\n(cohesion 0.5, unidirectional coupling: web-viewer → crash) ... Crash imports web-shared directly\n(documented bypass)\". So a Windows developer running the suite is told an intentional architectural\ndecision is a violation, and the obvious response — \"fix\" the import — would break the documented\ncycle-avoidance this exemption exists to permit.\n\nFIX: compare on a single canonical separator. Either build the prefix with `sep` instead of \"/\", or\nnormalize `rel` to posix once (`rel.split(sep).join(\"/\")`) and keep the forward-slash literals. Prefer\nONE helper used by all nine sites over nine independent edits, so the tenth exemption someone adds\ninherits correct behaviour rather than repeating the bug.\n\nNote the import specifiers themselves (\"../../shared/view-id.js\") are always forward-slash regardless of\nOS, since they are module paths, not filesystem paths — only the `rel` file paths need normalizing. Do not\n\"fix\" the import-side matching."
---
