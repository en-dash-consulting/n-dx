---
id: "9d6aa8c8-3ba4-42b2-bb6c-5474a858da2b"
level: "task"
title: "Diagnose and fix the release workflow so publishes create git tags and GitHub releases"
status: "pending"
priority: "high"
tags:
  - "0.7.1"
  - "release-plumbing"
  - "wm-2035"
source: "caos work management: WM2035 (Diagnose and fix the release workflow so publishes create git tags and GitHub releases); 0.7.1 execution plan PR group"
acceptanceCriteria:
  - "The publish run for 0.7.1 creates six tags (`@n-dx/core@0.7.1` and the other five packages) and six GitHub releases with the changelog sections as their bodies, with no manual step."
  - "The root cause is written in a comment in release.yml next to the fix."
  - "A workflow_dispatch run in validation mode still succeeds."
description: "Every npm publish since 0.4.6 (July 2026) has shipped packages without a git tag or GitHub release; 0.5.x and 0.6.0 are on npm with no tag in the repository. The workflow (.github/workflows/release.yml) uses changesets/action@v1 with `publish: pnpm exec changeset publish`; that command creates one annotated tag per published package (`@n-dx/<pkg>@<version>`) and the action pushes them and opens GitHub releases when it sees them in the publish output. Something in that chain stopped working around the move to npm trusted publishing (the workflow pins npm 11.15.0 before publishing). Find out which step fails or is skipped, fix it, and prove it with a workflow_dispatch validation run and the 0.7.1 publish.\n\nImplementation notes: Investigate why `changeset publish` under .github/workflows/release.yml no longer produces git tags or GitHub releases (last tag: @n-dx/*@0.4.6; npm has 0.5.x and 0.6.0). Read the Actions logs of the run that published 0.6.0 (the merge of the 'chore: version packages' PR #355 on 2026-09-12) and compare with the run that published 0.4.6. Check in order: whether `changeset publish` printed 'New tag:' lines; whether the job's GITHUB_TOKEN has contents: write; whether the action's createGithubReleases input is on; whether pinning npm to 11.15.0 or the trusted-publisher OIDC step changes the publish output the action parses; whether the fixed-group config in .changeset/config.json changes tag naming. Fix the cause, document it in a comment in the workflow, and confirm with a workflow_dispatch run. Do not add a separate tagging script if the action can be made to work; if it cannot, add an explicit step after publish that runs `git push --follow-tags` and creates releases with gh, and say why. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-21T17:24:09.308Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
