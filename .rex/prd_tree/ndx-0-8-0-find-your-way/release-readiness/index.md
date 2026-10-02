---
id: "bbb24b0b-47ad-4306-a083-8644da4cd1aa"
level: "feature"
title: "Release readiness"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "release-readiness"
source: "caos work management: feature ndx 0.8.0 - Release readiness"
acceptanceCriteria:
  - "changeset status is clean and the bump computes to a minor."
  - "The required tests, boundary tests and navigation contract pass on the release commit."
  - "The three documents are regenerated in the release pull request."
  - "The release note lists every redirect and every new config key."
  - "After the publish, every package has a 0.8.0 git tag and a GitHub release."
description: "Gate work for the 0.8.0 release: audit the changesets (scoped package names, minor bumps where the epic calls for them), regenerate docs/cli-ui-gap.md, the viewer architecture document and the README command reference, run the navigation contract, compare each shipped page against its wireframe and record the differences in the task rather than dropping them, run the package vulnerability scan, and write the release note listing every redirect added and every new configuration key.\n\n0.7.1 fixed the release plumbing this relies on: a publish now creates one git tag and one GitHub release per package, and the dependency audit is clean, so for 0.8.0 the vulnerability scan confirms rather than fixes.\n\nGoal: 0.8.0 ships with its documentation, contracts and release note matching what was built."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Audit the 0.8.0 changesets and run the package vulnerability scan](./audit-the-0-8-0-changesets-and-run-the.md) | pending |
| [Lock the README and docs/guide command references to the help registry](./lock-the-readme-and-docs-guide-command.md) | pending |
| [Make the ci child-cleanup e2e test deterministic under full-suite load](./make-the-ci-child-cleanup-e2e-test.md) | pending |
| [Regenerate the 0.8.0 documents, run the navigation contract and compare pages against the wireframes](./regenerate-the-0-8-0-documents-run-the.md) | pending |
| [Rewrite viewer-architecture.md for the shipped navigation model](./rewrite-viewer-architecture-md-for-the.md) | completed |
| [Write the 0.8.0 release note and confirm per-package tags and GitHub releases after publish](./write-the-0-8-0-release-note-and.md) | pending |
