---
id: "7ce15d95-320b-40e1-a256-28757ff37f89"
type: "task"
title: "ndx config credentials' Auth lines tell the user to store a key when the store was refused"
slug: "ndx-config-credentials-auth-lines-tell"
description: "Verdict: should-fix (ndx-adversarial-review of afd1638b). Scenario: credentials.json is 0644 and holds a claude key, and the project sets llm.claude.auth api. `ndx config credentials .` (which always passes --project) now prints 'claude: unknown, the store was not read' and the 'Store not read: … chmod 600' line, but the Auth section still says 'claude: api (llm.claude.auth api; no key: store one with ndx config credentials.claude)'. That is the same misdirection afd1638b removed from the credential lines. Location: packages/llm-client/src/vendor-auth.ts:243 (describeVendorAuth), called from vendorAuthStatuses in packages/llm-client/src/cli/credentials.ts. Reachable through every `ndx config credentials` on a refused store with an api-mode vendor. The 'Store not read' line is in the same output, which is why this is low. Options: (A, recommended) pass the store problem into describeVendorAuth (or VendorAuthDecision) and print 'no key: the credential store was not read' in place of the store hint; this needs one field and one branch. (B) Suppress the hint whenever the output already carries a 'Store not read' line; this is cheaper but couples the two formatters."
acceptanceCriteria:
  - "With a 0644 credentials.json and llm.claude.auth api in the project, `ndx config credentials .` prints no 'store one with ndx config credentials.claude' hint on the claude Auth line (e2e, POSIX)"
  - "That Auth line says the key is unknown because the store was not read"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "credential-store"
source: "ndx-adversarial-review"
---
