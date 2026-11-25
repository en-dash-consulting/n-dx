---
id: "c3ee8669-70a0-444a-957f-d61c0b401dbb"
type: "change"
title: "Release PRs pass their required checks without a bypass"
slug: "release-prs-pass-their-required-checks"
summary: "The automatic \"Version Packages\" release pull request fails one of its required checks every time, so each release has been merged by overriding the branch rules. This change makes that check understand release PRs, and adds a guard that stops a PR from editing a release note that the next release would delete."
intent: "Release PRs #1015 (0.10.4) and #1054 (0.10.5) were both merged by bypassing the branch rules. Their only failing required check was Build & Validate, and within it the last Linux step, \"Validate changesets\" (`pnpm exec changeset status --since=origin/main` in .github/workflows/ci.yml). A version PR consumes every `.changeset/*.md` and bumps each `package.json`, so `changeset status` sees changed packages and no changesets and exits 1 (\"Some packages have been changed but no changesets were found\"). The step before it, \"Require changeset\", already skips the release PR; \"Validate changesets\" has no exemption.\n\nSeparately, after 0.10.5 shipped PR #1094 hit a modify/delete conflict on .changeset/hench-php-guards.md: it edited a changeset that was already on main, the release consumed and deleted it, and the edit would never have been released. Rule to enforce: a PR adds its own changeset files and never edits one already on main.\n\nThe merge queue matters for both fixes: ci.yml triggers on `merge_group`, where `github.head_ref` is empty, so a bare `head_ref != 'changeset-release/main'` condition would still run the step in the queue and fail it. The `on:` block comment already requires head_ref checks to be gated on `github.event_name == 'pull_request'`.\n\nNo changeset for this PR: it touches only .github/, tests/, scripts/ and docs, and \"Require changeset\" skips PRs that touch no package source. Do not add an empty changeset (it stalls the Release run). The real end-to-end check is the next Version Packages PR passing Build & Validate without a bypass."
acceptanceCriteria:
  - "The Version Packages PR (branch changeset-release/main) passes Build & Validate under both pull_request and merge_group without anyone bypassing branch rules"
  - "Every other PR still has its changeset front matter validated, and push to main still runs Validate changesets"
  - "A PR that modifies or renames a changeset already present on origin/main fails Build & Validate with a message naming the files and telling the author to add a new changeset instead"
  - "A text-level test fails if either the exemption or the guard is removed from ci.yml, or if the exemption depends on head_ref without an event guard"
  - "The rule 'add a new changeset; never edit one already on main' is documented where changeset authors read it and reaches AGENTS.md"
touches:
  - "84562611-0193-412e-8642-7f5b0fab1d85"
priority: "high"
tags:
  - "ci"
  - "release"
---
