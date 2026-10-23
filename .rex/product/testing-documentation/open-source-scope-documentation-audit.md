---
id: "491547b6-480e-4091-8b53-5c57a27bc5a5"
type: "capability"
title: "Open Source Scope Documentation Audit and Cross-Reference"
slug: "open-source-scope-documentation-audit"
statement: "OPEN_SOURCE_SCOPE.md classifies every package as included or excluded, states licensing boundaries and contribution expectations, and is linked from the README and the assistant instruction files."
criteria: [{"id":"c1","text":"The README shall link to OPEN_SOURCE_SCOPE.md in a visible section, such as Contributing or License."},{"id":"c2","text":"AGENTS.md, or its source template packages/core/assistant-assets/project-guidance.md, shall reference OPEN_SOURCE_SCOPE.md."},{"id":"c3","text":"CLAUDE.md shall reference OPEN_SOURCE_SCOPE.md so that AI assistants surface it when it is relevant."},{"id":"c4","text":"Each link to OPEN_SOURCE_SCOPE.md shall resolve to a relative path where the file exists."},{"id":"c5","text":"OPEN_SOURCE_SCOPE.md shall classify every package in packages/ as either included or excluded."},{"id":"c6","text":"The licensing boundaries section of OPEN_SOURCE_SCOPE.md shall give the correct license identifier for every included component."},{"id":"c7","text":"OPEN_SOURCE_SCOPE.md shall have a contribution expectations section that describes how to contribute, covering pull requests, issues and code style."},{"id":"c8","text":"OPEN_SOURCE_SCOPE.md shall name only components, paths and descriptions that exist in the current codebase."}]
source: "smart-add"
---

OPEN_SOURCE_SCOPE.md exists but may be stale relative to the current codebase and is not consistently referenced from the project's primary documentation surfaces. This feature ensures the file accurately reflects included/excluded components, licensing boundaries, and contribution expectations, and is discoverable from README and other key docs.
