---
id: "7e14ce05-95ad-4fa4-adc9-73d0c6742566"
type: "capability"
title: "Codex Workflow Support"
slug: "codex-workflow-support"
statement: "N-DX runs Codex workflows under session-auth login, using one consistent Codex model catalog and accounting for Codex token usage."
criteria: [{"id":"c1","text":"When a user is authenticated through codex login (ChatGPT session) without OPENAI_API_KEY, the quota retrieval shall either return the Codex quota or report that quota is unavailable for codex login, rather than silently skipping it."},{"id":"c2","text":"When matching Codex usage records to a configured model, the quota retrieval shall match dated deployment ids of that model, not only an exact model-id match."},{"id":"c3","text":"The configuration surface shall offer one consistent catalog of Codex model identifiers across init and the model catalog."},{"id":"c4","text":"The model resolver shall map every legacy Codex model alias to a model that exists in the Codex tier models, including the light tier."},{"id":"c5","text":"The model resolver shall resolve the newest Codex model to a model id the Codex CLI accepts."},{"id":"c6","text":"If a configured model is incompatible with Codex, the run command shall report an error that suggests current Codex models."},{"id":"c7","text":"While the event pipeline is enabled, when Codex stdout is not a single JSON document, the CLI loop shall parse Codex token usage from the output and record token and credit totals."}]
priority: "critical"
---

Type: Bug/Story. Improve Codex support so N-DX is usable with Codex workflows.

User Story: As an N-DX user working with Codex, I want Codex workflows to function properly, so that N-DX supports the toolchain it claims or intends to support.

Acceptance Criteria:
- Given a user configures N-DX for Codex usage, when a supported Codex workflow is executed, then the workflow completes successfully.
- Given Codex support is incomplete or unavailable, when the user attempts to use it, then the limitation is clearly surfaced.
- Given Codex-related failures occur, when errors are displayed, then the user receives actionable information.

Notes: Codex is considered largely unusable with N-DX today, making this a P0 usability blocker.
