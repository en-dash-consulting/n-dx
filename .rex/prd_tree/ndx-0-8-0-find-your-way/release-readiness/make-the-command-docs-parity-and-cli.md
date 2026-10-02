---
id: "303ce0e9-f564-4b46-8a0a-5c4cd77f16c4"
level: "task"
title: "Make the command-docs parity and cli-ui-gap drift tests pass on Windows CRLF checkouts"
status: "pending"
priority: "critical"
acceptanceCriteria: []
description: "CLI Smoke (Windows) fails on PR #508 (run 37054213215, job 111000705298) in the two tests this branch added. The Windows runner checks out README.md and docs/*.md with CRLF (core.autocrlf=true; .gitattributes pins LF only for .rex/, .hench/, .sourcevision/, .n-dx.json, AGENTS.md and CLAUDE.md). (1) tests/e2e/command-docs-parity.test.js: readmeCommandsSection() searches for '\n## Commands\n' and throws 'README.md has no \"## Commands\" section'; the row regex also never sees an LF-only line. (2) tests/e2e/cli-ui-gap-drift.test.js 'matches what the generator produces': the committed CRLF file is compared with buildCliUiGap(committed), which splices an LF section, so they never match ('docs/cli-ui-gap.md is stale'). Fix by normalising CRLF to LF on read in both tests, the same way tests/e2e/assistant-body-drift.test.js:42 does (const norm = (s) => s.replace(/\\r\n/g, '\n')). Also make scripts/build-cli-ui-gap.mjs preserve the file's existing line ending when it writes, so running the generator on a Windows checkout does not produce a mixed-ending file. Do not change .gitattributes and do not touch the documents' content. Test-only plus the generator script: no changeset needed. Constraints that apply to every n-dx change: orchestration scripts in packages/core spawn CLIs and never import packages; run pnpm preflight before opening the PR.\n\nAcceptance criteria: (1) Each of the two tests has a case that feeds a CRLF copy of its document (README.md Commands section; docs/cli-ui-gap.md) and passes, proving the Windows checkout is handled without a Windows runner. (2) The existing assertions are unchanged and still pass on LF. (3) node scripts/build-cli-ui-gap.mjs run on a CRLF copy writes CRLF throughout (no mixed line endings), covered by a test. (4) No change to .gitattributes, README.md, docs/guide/commands.md or docs/cli-ui-gap.md content."
lastModified: "2026-10-02T20:01:46.205Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
