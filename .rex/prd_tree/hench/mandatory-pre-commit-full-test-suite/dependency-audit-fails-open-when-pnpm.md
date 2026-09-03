---
id: "813ae0de-9d6c-4d39-82bd-92aa4416c07d"
level: "task"
title: "Dependency audit fails open when pnpm audit cannot be launched"
status: "pending"
priority: "medium"
tags:
  - "hench"
  - "security"
  - "dependency-audit"
  - "fail-open"
source: "ndx-work"
acceptanceCriteria:
  - "`runDependencyAudit` distinguishes an audit that ran and found nothing from one that could not be executed"
  - "A launch failure in either `pnpm audit` or `pnpm outdated` never contributes all-zero counts to the `hasIssues` calculation"
  - "The bare `catch {}` blocks record why the step failed rather than discarding the error"
  - "`DependencyAuditResult.ran` is false when neither step produced parseable output, with a reason attached"
  - "A decision is recorded in the code for what an inconclusive audit means for the caller (block, warn, or proceed), with the reasoning stated"
  - "Unit test asserts a `launched: false` exec result does not yield a clean audit report"
  - "Unit test asserts a genuine clean audit is still reported as clean (no regression)"
description: "Found while auditing `execShellCmd` call sites for task 02351b92 (the `launched` gap). Annotated in place at `packages/hench/src/tools/test-runner.ts` steps 1 and 2 of `runDependencyAudit`, and deliberately not fixed there — the correct behaviour is a design decision about a security gate, not a mechanical `launched` check.\n\nBoth steps swallow a launch failure and report a clean result:\n\n```ts\ntry {\n  const auditResult = await execShellCmd(\"pnpm audit --json\", {...});\n  auditExitCode = auditResult.exitCode;\n  if (auditResult.exitCode !== null && auditResult.stdout) {\n    // parse vulnerabilities\n  }\n} catch {\n  // pnpm audit failed, continue with outdated check\n}\n```\n\nWhen the command cannot be spawned, `exec` returns exitCode 1 with empty stdout. The `stdout` guard is falsy, so the parse is skipped, `vulnerabilities` stays at its all-zero initial value, and the function computes `hasIssues` from those zeros — returning \"no vulnerabilities found\" for an audit that never ran. The same holds for `pnpm outdated`. The bare `catch {}` hides any throw as well.\n\nThis fails OPEN, which is the opposite of the direction a security gate should fail, and it is worse than the defect 02351b92 addressed: that one was loudly wrong, this one is silently reassuring.\n\n`DependencyAuditResult` already carries `ran` and `skipReason`, so the shape to express this exists. The open question is what an unrunnable audit should mean for the caller — block the run, warn and proceed, or surface as a distinct inconclusive state — which is why it is captured rather than guessed at."
lastModified: "2026-09-03T21:23:17.547Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
