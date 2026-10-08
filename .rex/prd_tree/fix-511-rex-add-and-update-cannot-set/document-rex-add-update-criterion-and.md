---
id: "9e540e68-f293-41b6-b2ab-945c61c85c6d"
level: "task"
title: "Document rex add/update --criterion and --source and add the @n-dx/rex changeset"
status: "pending"
priority: "medium"
tags:
  - "fix"
  - "rex"
  - "docs"
blockedBy:
  - "673e5666-7ad9-477f-a7e4-63dca792ef36"
  - "81535cd7-a0de-4c93-b9cc-5974b3312bba"
source: "ndx-capture"
acceptanceCriteria:
  - "docs/packages/rex.md shows --criterion and --source for rex add and the replace/clear forms for rex update."
  - "No doc in the repo still says acceptance criteria can only be set through MCP or should be folded into --description."
  - "`.changeset/rex-cli-criteria-source.md` exists with `\"@n-dx/rex\": patch` and references #511, and `changeset status` accepts it."
  - "No files under .claude/ or packages/core/assistant-assets/skills/ are changed."
description: "Last task of the #511 epic. Read the epic description for conventions.\n\n1. `docs/packages/rex.md`: in the command block (around lines 28–32, next to the `rex update ... --run` lines) add one `rex add task --title=... --criterion=... --criterion=... --source=...` line and one `rex update <id> --criterion=...` line, plus a `rex update <id> --criterion=` clear line. Keep the existing comment style.\n2. Search the rest of the docs for other CLI references to adding or editing items that claim criteria can only be set through MCP, or that tell the reader to fold criteria into `--description` (`grep -rn \"acceptance\" docs README.md packages/*/README.md`), and correct any you find. Do not edit anything under `.claude/` and do not edit `packages/core/assistant-assets/skills/` (generated skill copies must stay in sync; that is out of scope).\n3. Add one changeset at `.changeset/rex-cli-criteria-source.md` with frontmatter `\"@n-dx/rex\": patch` and a one-paragraph body: `rex add` and `rex update` gain repeatable `--criterion` and `--source`, matching MCP add_item / edit_item (#511).\n4. Run `pnpm changeset status` (or `node_modules/.bin/changeset status`) to confirm the scoped name resolves.\n\nBefore finishing, run the docs-related root tests that touch these files if any exist (e.g. `grep -rln \"docs/packages/rex.md\" tests` and run what it finds)."
lastModified: "2026-10-08T18:23:32.351Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
