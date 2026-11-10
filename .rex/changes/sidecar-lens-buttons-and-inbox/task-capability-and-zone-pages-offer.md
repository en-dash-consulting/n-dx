---
id: "a19056bd-24e5-4e73-a578-7d66484c432a"
type: "task"
title: "Task, capability and zone pages offer Ask and Explain in the Sidecar; the Inbox page defaults to Place"
slug: "task-capability-and-zone-pages-offer"
description: "Story D gaps. Add in-page buttons that open the Sidecar drawer with the page's item attached and its lens chosen: on a task page 'Ask Sidecar' (Describe, or Diagnose run when its last run failed, as use-sidecar-attachment.ts already maps), and 'Explain in Sidecar' on capability and zone pages (Explain lens). Reuse the existing open-with-target path (see components/place-with-sidecar.ts and views/workspaces.ts 'Ask Sidecar'). Map the inbox view in use-sidecar-attachment.ts so opening the drawer on the Inbox defaults to the Place lens, with the selected change attached when one is selected. Buttons appear only while web.sidecar is on. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; add a patch changeset per package touched."
acceptanceCriteria:
  - "A task page shows Ask Sidecar, and a capability or zone page shows Explain in Sidecar, each opening the drawer with that item attached and the matching lens (viewer tests)"
  - "Opening the drawer on the Inbox page picks the Place lens (viewer test)"
  - "With web.sidecar off, none of the buttons render (viewer test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
