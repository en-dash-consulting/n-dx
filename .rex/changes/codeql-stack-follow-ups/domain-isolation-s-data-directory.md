---
id: "4d804615-adce-4ded-b802-a9a02db6a99d"
type: "task"
title: "domain-isolation's data-directory regex escapes every metacharacter"
slug: "domain-isolation-s-data-directory"
description: "tests/e2e/domain-isolation.test.js ~772 builds its twin of ci.js's data-directory regex with a replace that escapes only the first dot and only the dot. Harmless on the current constants (.rex, .hench, .sourcevision, .ndx/rex); the test-side twin of CodeQL alert 32, which layer 6 of stack #855 fixed in ci.js with escapeRegExp. Use a full regex escape in the test too."
acceptanceCriteria:
  - "The test builds its pattern with a full regex escape and still passes on the current layout names"
priority: "low"
source: "codeql-triage"
---
