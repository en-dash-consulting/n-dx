---
id: "74838585-5fc7-436e-ba6c-f378be47807f"
type: "task"
title: "Clear the CodeQL alerts in the slot and sandbox tests"
slug: "clear-the-codeql-alerts-in-the-slot"
summary: "GitHub's code scanner flags three spots in this change's tests, one as high severity, which fails the PR's security check. None is a real vulnerability, but rewriting the tests in the plain, safe form clears the check without dismissing alerts by hand."
description: "PR 3 (#1035) CodeQL check fails on alerts introduced by this change's tests. Both are test-only and not exploitable, but fix the code rather than dismiss them.\n\n1. Alert #121, HIGH, `js/incomplete-sanitization` (\"This replaces only the first occurrence of \\\"}}\\\"\") at `packages/hench/tests/unit/process/validation-slot.test.ts:378`, in \"reads a record without namespace fields as written in no known namespace\":\n   `expect(parseValidationSlotHolder(raw.replace(\"}\", ',\"pidNamespace\":7}'))).toBeNull();`\n   Build the variant from an object instead of patching the JSON string, e.g. keep the record as an object, `const raw = JSON.stringify(record)` and `JSON.stringify({ ...record, pidNamespace: 7 })`. Keep exactly what the test asserts. Search the rest of this file and `packages/hench/tests/**/validation-slot*`, `tests/e2e/validation-slot-parity.test.js` and `scripts/lib/validation-slot.mjs`'s tests for the same `.replace(` on JSON pattern and fix any you find the same way.\n\n2. Alerts #122 and #123, medium, `js/bad-code-sanitization` (\"Code construction depends on an improperly sanitized value\") at `packages/llm-client/tests/unit/sandbox.test.ts:664-665`: the live sandbox probe builds a `node -e` script that interpolates paths with `${JSON.stringify(join(home, ...))}` (the `slot`, `auth.token` and `credentials.json` paths, around lines 656–665). Pass the paths to the probe as arguments instead (`wrapInSandbox(process.execPath, [\"-e\", probe, slotPath, tokenPath, storePath], ...)`, read with `process.argv` inside the probe, checking which argv index node gives `-e` scripts), so the probe source is a constant. Apply the same change to any other probe in that file that interpolates values into `-e` source. Keep the assertions unchanged.\n\nDo not touch `packages/llm-client/src/exec.ts` (alert #83 predates this stack and is on main).\n\nRun the two changed test files (the sandbox test's live cases run on macOS under Seatbelt) and the static root policy tests. No changeset: tests only. No `process.env.NDX_*` writes in tests."
acceptanceCriteria:
  - "validation-slot.test.ts builds the namespace variant from an object, with no string .replace on serialized JSON, and asserts the same thing"
  - "sandbox.test.ts probes take paths as process arguments; no -e script source interpolates a value"
  - "Both test files pass locally (sandbox live cases on macOS); src/exec.ts is untouched"
priority: "high"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-3-runner-slot"
  - "review-fix"
  - "codeql"
source: "ndx-capture"
---
