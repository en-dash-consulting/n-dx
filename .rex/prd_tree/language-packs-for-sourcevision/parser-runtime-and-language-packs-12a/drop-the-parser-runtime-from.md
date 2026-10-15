---
id: "1a548852-b37f-4c21-a987-dd3dc239e59d"
level: "task"
title: "Drop the parser runtime from sourcevision and enforce dynamic-only pack loading"
status: "completed"
priority: "high"
tags:
  - "language-packs"
  - "lang-runtime"
  - "sourcevision"
  - "architecture-policy"
  - "pr-12a"
blockedBy:
  - "b782c83c-46f4-4610-b000-a12864198aa5"
source: "roadmap"
startedAt: "2026-10-15T03:13:53.526Z"
completedAt: "2026-10-15T03:26:55.091Z"
endedAt: "2026-10-15T03:26:55.091Z"
resolutionType: "code-change"
resolutionDetail: "sourcevision drops web-tree-sitter (package.json only; operator must run pnpm install). Its tests reach packs through the loader (tests/helpers/workspace-pack.ts) with no static runtime/pack import. The grammar smoke tests moved to lang-java and lang-go. A new architecture-policy block, \"packs are loaded, never imported\", is registered in DOCUMENTED_POLICIES (now 24), and the domain-isolation sourcevision rule names the pack tier. packed-tarball checks that sourcevision's tarball has no wasm or queries and that every pack has its grammar and queries. Adds packages/sourcevision/AGENTS.md and CLAUDE.md."
acceptanceCriteria:
  - "`git grep -nE \"web-tree-sitter|@n-dx/lang-runtime\" packages/sourcevision/src packages/rex/src packages/hench/src packages/web/src packages/core packages/llm-client/src` finds nothing, and packs are imported only dynamically from sourcevision's loader module"
  - "packages/sourcevision/package.json has no web-tree-sitter dependency and its `files` lists no queries or grammars; the run summary tells the operator to run `pnpm install`"
  - "architecture-policy fails when a static `import \"@n-dx/lang-java\"` is added to any non-pack package (checked by the reviewer), and the DOCUMENTED_POLICIES count matches"
  - "Tests cover: no packs (Java inventory + notice, Go regex + notice), pack-dir precedence, version mismatch refusal"
  - "The packed-tarball check passes: no grammar in sourcevision's tarball, each pack's tarball has its grammar and queries"
  - "sv analyze output and the Java, Go and SQL corpus reports equal PR 11's"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "Finish decision 6: sourcevision no longer carries the parser runtime, any grammar or any query, and the architecture policy makes sure nothing brings them back.\n\nsourcevision:\n- No import of @n-dx/lang-runtime or web-tree-sitter anywhere in packages/sourcevision/src; the only references to a pack are the loader's dynamic imports. Remove src/language/package-paths.ts if nothing needs it, and the `build:grammars` script.\n- packages/sourcevision/package.json: remove `web-tree-sitter` from dependencies and `src/language/queries` and `build/grammars/*.wasm` from `files`. This changes the lockfile, which agents cannot regenerate: make the package.json edit, do not run pnpm, and say in the run summary that the operator must run `pnpm install` before CI's `--frozen-lockfile` passes. Leave the lang-* devDependencies and the lang-go optional dependency as they are.\n- Tests that still need a grammar belong to a pack; move any that remain. sourcevision's own tests must pass with no grammar built anywhere (they may still use the workspace packs through the loader).\n\nPolicy (tests/e2e/architecture-policy.test.js and domain-isolation.test.js, plus the DOCUMENTED_POLICIES registry and its count):\n- No static import of @n-dx/lang-runtime or of any @n-dx/lang-<pack> outside packages/lang-* (sourcevision, rex, hench, web, core, llm-client, lang-kit, graview, graview-face); sourcevision's loader may import packs only dynamically, and only from the loader module.\n- web-tree-sitter is a dependency of @n-dx/lang-runtime only.\n- Update the domain-isolation header and the sourcevision import rule to name the pack tier.\n\nBehaviour, with tests (inject the pack directory and the import function):\n- No packs at all: a Java project gets inventory and one notice; a Go project gets regex edges and one notice; analysis does not throw.\n- A pack in the per-user pack directory is used ahead of one found by resolution.\n- A pack whose version differs from sourcevision's is refused with the fixing command.\n\nPackaging: tests/e2e/packed-tarball.test.ts (or its sourcevision counterpart) checks that the sourcevision tarball holds no .wasm and no queries, and that each pack's tarball holds its own grammar and queries; CI and release build every pack's grammar before tests and publish (`SV_REQUIRE_GRAMMARS=1` still turns a missing grammar into a failure, now in the pack suites).\n\nDocs: packages/sourcevision/AGENTS.md says how packs are found, refused and degraded; each lang-* AGENTS.md drops the \"placeholder\" line.\n\nVerify: the full byte-identity bar (sv analyze output and the Java, Go and SQL corpus reports equal PR 11's), every lang-* suite, sourcevision, root policy suites."
lastModified: "2026-10-15T03:26:55.363Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
