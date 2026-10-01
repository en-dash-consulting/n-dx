---
id: "497212a6-b1ff-479d-88f1-443ad7aed717"
level: "task"
title: "Add a SECURITY.md with a private reporting route"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "request-hardening"
  - "docs"
source: "0.8.0 request hardening (2026-10-01)"
acceptanceCriteria:
  - "SECURITY.md exists at the repository root with supported versions, a private reporting route, what to include in a report and response expectations."
  - "README (and CONTRIBUTING.md if present) link to SECURITY.md."
  - "The PR notes whether GitHub private vulnerability reporting is enabled for the repository."
description: "The repository is public and has no security policy, so the only visible way to report a security problem is a public issue. Add `SECURITY.md` at the repository root: which versions get security fixes (the current minor line), how to report privately (GitHub's private vulnerability reporting for this repository, and an email address the maintainers choose), what to include, and the response expectations. Enable private vulnerability reporting in the repository settings if it is not already on (a maintainer does this; note it in the PR). Link the file from the README's contributing section and from CONTRIBUTING.md if that file exists."
lastModified: "2026-10-01T15:48:29.423Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
