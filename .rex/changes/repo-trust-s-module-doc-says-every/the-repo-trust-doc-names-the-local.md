---
id: "f11618dd-4fb2-4b52-b78d-ac3eb326dfb8"
type: "task"
title: "The repo-trust doc names the local-config gates that are used, and the unused helper goes"
slug: "the-repo-trust-doc-names-the-local"
description: "Fix for change dfa630df, found by the adversarial review of 0681b775 (run 2fe1f329): llm-client exports userLocalConfigApplies and the repo-trust module doc says every local-config reader asks it, but no production code calls it; the gates read localConfigTracked from the evaluation they hold, and trustedLocalConfig calls isLocalConfigTracked. Fix, the review's option 1: remove the export and its test assertions, and point the doc at the mechanisms in use. If the hench gateway re-exported it, lower tests/e2e/architecture-policy.test.js's ceiling to match. Kept in layer 2 by the session on 2026-10-27; runs after 139b71eb's task."
acceptanceCriteria:
  - "Closes #686 (follow-up): the documented local-config trust gate is the one every reader uses"
  - "The repo-trust module doc names the mechanisms local-config readers actually use (localConfigTracked on the evaluation, trustedLocalConfig), with no claim about a helper they do not call"
  - "@n-dx/llm-client exports no local-config trust helper that production code does not call"
  - "Tests fail on the code before the fix"
priority: "low"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
source: "ndx-adversarial-review"
---
