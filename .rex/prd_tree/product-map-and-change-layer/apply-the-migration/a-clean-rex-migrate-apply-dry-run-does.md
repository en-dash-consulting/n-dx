---
id: "3e5c1961-601d-46d2-8eb6-1a11f45aa299"
level: "task"
title: "A clean rex migrate --apply --dry-run does not mean apply would proceed: the write and read-back checks are skipped"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-23"
  - "lane-migration"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A v1 tree whose built v2 model fails apply's read-back check makes rex migrate --apply --dry-run exit non-zero with the same message apply gives (test)"
  - "The dry run still writes nothing under the project directory (test)"
description: "Verdict: should-fix (from the review of 1c70426e).\n\nScenario: suppose the v1 tree builds a v2 model that writePrdModel throws on, or that reads back with skipped warnings. Examples are a slug collision, or a node the writer refuses. `rex migrate --apply --dry-run` prints a clean report and exits 0. The real `rex migrate --apply` then refuses with \"The written v2 tree does not read back\" or the writer's error. The task promised that a clean dry run means apply would proceed.\n\nEvidence: rehearseV1ToV2 in packages/rex/src/migrations/v1-to-v2/apply.ts stops after prepare(). The staged writePrdModel, the loadPrdModel read-back with its skipped-warning refusal, and the second assertEveryV1Id run only in applyV1ToV2.\n\nReachable: through `ndx migrate --apply --dry-run` and `rex migrate --apply --dry-run`, but only when the writer or reader has a defect. A rehearsal on this repo read back with 0 warnings.\n\nOptions:\n1. (Recommended) In the dry run, write the model to an OS temp directory outside the project, read it back with the same checks, report the file count, and remove the temp directory. Shares the code with apply's staging step. Cost: one helper and a test with a model that fails to read back. Risk: a slower dry run on large trees.\n2. Document that the dry run checks only the plan and the id coverage, not the write. Free, but it weakens the rehearsal gate."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T08:51:10.429Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
