---
id: "e63a26bc-dcad-4624-9189-43da3e1e7184"
type: "task"
title: "Standalone release builds ignore the requested release tag"
slug: "standalone-release-builds-ignore-the"
summary: "Release downloads could be built from the latest main instead of the release they were attached to; builds for a release now check out that release and confirm its version."
description: "Review 4672392651 (P2): .github/workflows/standalone-exe.yml uses release-tag only in the upload job; the build checks out the dispatch ref. Fix: check out the release tag when one is given, verify the packaged @n-dx/core version matches the tag before upload, keep the dispatch ref otherwise."
acceptanceCriteria:
  - "With release-tag set, every build job checks out that tag"
  - "The upload refuses when the packaged version does not match the tag"
  - "Without release-tag the dispatch ref is built as before"
priority: "medium"
source: "pr-review"
---
