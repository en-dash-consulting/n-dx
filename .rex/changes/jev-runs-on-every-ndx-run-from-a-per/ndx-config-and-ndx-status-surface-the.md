---
id: "afd1638b-3f09-4e88-b50b-f09ecdd7b774"
type: "task"
title: "ndx config and ndx status surface the credential CLI's warnings and refusals"
slug: "ndx-config-and-ndx-status-surface-the"
description: "Should-fix from the #942 review. spawnCredentialsCli in packages/core/config.js returns stderr: \"\" on exit 0, and with stdio 'pipe' the child's stderr never reaches the user. (1) On Windows, writeStoreAtomic warns 'could not restrict permissions' and still moves the file into place; the user sees only 'Stored typesafe.' while the key keeps an inherited ACL. (2) A store at 0644, with invalid JSON or an unknown version, shows 'typesafe: not set' and the 'Refusing to read… chmod 600' reason is lost, so the user re-stores a key instead of fixing the mode. formatJevLine in packages/core/cli.js (ndx status) has the same pattern: 'jev: unavailable (store a key…)' for a 0644 store. Fix: capture stderr on success (spawnSync) and forward it; have status distinguish 'not set' from 'refused'."
acceptanceCriteria:
  - "A warning the credential CLI writes to stderr on a successful set reaches the ndx config user's stderr"
  - "ndx config credentials on a group- or world-readable store names the refusal and the chmod fix instead of 'not set'"
  - "ndx status's jev line on a refused store names the refusal instead of telling the user to store a key"
  - "No forwarded output contains a credential value"
priority: "medium"
tags:
  - "credential-store"
  - "review-followup"
  - "core"
source: "stack review of #942/#949/#952 (2026-11-03)"
---
