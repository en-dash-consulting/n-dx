---
id: "52db514f-8426-4fe7-83b5-339de35c3007"
type: "task"
title: "Test the changeset CI steps and document the never-edit-a-changeset rule"
slug: "test-the-changeset-ci-steps-and"
summary: "Add tests that break if either CI fix is removed, and write the rule \"add a new changeset; never edit one already on main\" where people and assistants who write changesets will read it."
description: "Tests:\n- Add tests/e2e/ci-changeset-checks.test.js in the style of tests/e2e/ci-draft-pr-gate.test.js and tests/e2e/ci-merge-queue-trigger.test.js: read .github/workflows/ci.yml as text, normalise CRLF to LF, no YAML dependency. Locate the \"Validate changesets\" step and the edited-changeset guard step by name and assert on their text. It must fail if the version-PR exemption is removed, if the guard is removed, or if the exemption's condition uses github.head_ref without a github.event_name == 'pull_request' guard. Write the assertions as pure functions over the YAML text so the test can also prove they reject a mutated copy of ci.yml with each step (or the exemption) removed, without writing files.\n- If T1/T2 moved the logic into a script under scripts/ (e.g. scripts/changeset-pr-checks.mjs), unit-test its exported pure functions instead (version PR detected; a normal PR with added changesets is not; modified/renamed existing changesets are reported; additions, deletions and README.md are not) and keep the YAML test thin: it checks the steps exist and call the script. Check how root tests are discovered (scripts/run-all-tests.mjs, vitest config) so the new file actually runs in the root suite.\n\nDocs:\n- Add the rule \"add a new changeset; never edit one already on main — the next release may consume it\" to .claude/skills/ndx-release-notes/SKILL.md, section 1 (Writing a changeset), with one sentence on why (PR #1094's modify/delete conflict) and that CI now enforces it.\n- Add a one-line bullet with the same rule to the \"Changeset Versioning\" section of packages/core/assistant-assets/project-guidance.md (shared guidance). Then regenerate the instruction files with `node packages/core/cli.js init --no-commit .` and keep only the instruction-file changes (AGENTS.md, CLAUDE.md and any nested instruction files it rewrites); restore everything else init touches (sourcevision output, .rex, configs) with git checkout/clean so only instruction files and your edits remain in the diff. Never edit AGENTS.md or CLAUDE.md by hand for this.\n- Keep within tests/e2e/agents-md-size-budget.test.js: one short bullet, not a paragraph.\n\nDo not add a changeset."
acceptanceCriteria:
  - "The new test fails on a copy of ci.yml with the Validate changesets exemption removed, and on a copy with the edited-changeset guard removed"
  - "The new test fails if the exemption depends on github.head_ref without an event_name == 'pull_request' guard"
  - "If a script under scripts/ holds the logic, its pure functions have unit tests covering version PR, normal PR, modified, renamed, added, deleted and README.md cases"
  - "The rule appears in .claude/skills/ndx-release-notes/SKILL.md and, via project-guidance.md and ndx init, in AGENTS.md"
  - "tests/e2e/instruction-alignment.test.js and tests/e2e/agents-md-size-budget.test.js pass"
  - "The diff contains no files that ndx init touched other than instruction files"
priority: "high"
tags:
  - "ci"
  - "release"
  - "docs"
blockedBy:
  - "044b9de7-6f19-401c-b094-291a2ad11dad"
  - "bbe2e8e7-cdc3-467a-a8a7-90ee8e90978b"
  - "2c091a65-08aa-4a78-a118-e12ce22ff80c"
---
