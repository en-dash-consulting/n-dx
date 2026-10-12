---
id: "efc173f4-fcbd-4da9-b152-9f3ca22ab4af"
level: "task"
title: "Gate CodeQL and Dependency Review on non-draft pull requests"
status: "pending"
priority: "high"
tags:
  - "hotfix"
  - "ci"
  - "github-actions"
acceptanceCriteria:
  - "codeql.yml and dependency-review.yml `pull_request:` list types opened, synchronize, reopened, ready_for_review, converted_to_draft"
  - "codeql.yml `analyze` and dependency-review.yml `dependency-review` carry the job-level `if: github.event_name != 'pull_request' || github.event.pull_request.draft == false`"
  - "codeql.yml push-to-main and weekly schedule scans still run (no merge_group trigger is added)"
  - "codeql.yml has a concurrency group that cancels in-progress runs only for pull_request events"
  - "Job names \"Analyze\" and \"Dependency Review\" are unchanged"
run: {"tier":"light"}
description: "Edit .github/workflows/codeql.yml and .github/workflows/dependency-review.yml.\n\ncodeql.yml: runs on push to main, pull_request and a weekly schedule.\n- Give `pull_request:` `types: [opened, synchronize, reopened, ready_for_review, converted_to_draft]`. Keep the existing \"No merge_group trigger, deliberately\" comment where it is.\n- Add to the `analyze` job: `if: github.event_name != 'pull_request' || github.event.pull_request.draft == false`. The event_name guard is required, otherwise the push-to-main and scheduled scans would skip.\n- codeql.yml has no `concurrency:` block. Add one (`group: codeql-${{ github.ref }}`, `cancel-in-progress: true`) so converted_to_draft and new pushes cancel an in-flight PR scan. Check that this cannot cancel the scheduled run against main in a way that matters: a push to main and the schedule share refs/heads/main, so use `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` to cancel only PR runs.\n\ndependency-review.yml: pull_request only.\n- Same `types:` list.\n- Add to `dependency-review` the same `if:` expression as above, for consistency with the other workflows (the event_name half is redundant here but keeps one pattern across files).\n\nOne short comment above each new `types:` and `if:`, matching the existing comment style."
lastModified: "2026-10-12T19:08:36.283Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
