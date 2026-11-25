---
id: "0219ad8c-a6a0-4dbd-a721-c24c48b7364f"
type: "task"
title: "Write init's guidance as a managed block and keep the rest of CLAUDE.md and AGENTS.md"
slug: "write-init-s-guidance-as-a-managed"
summary: "Stop init from replacing a project's own instruction files: it updates only its own marked section and leaves everything else alone."
description: "writeClaudeMd (packages/core/claude-integration.js) and writeAgentsMd (packages/core/codex-integration.js) replace the whole file. Instead, wrap the generated content in begin/end markers (for example `<!-- ndx:begin generated — re-run ndx init to update -->` … `<!-- ndx:end -->`). On write: no file → write the block; a file with the markers → replace only what is between them; a file without markers → keep its content and add the block after it (never drop text). Content outside the markers belongs to the project and is never rewritten. Share the splice helper between the two writers rather than duplicating it. Move the \"do not edit manually\" wording inside the block so it applies only there. The n-dx repository's own files get the markers too; update the drift tests (assistant-body-drift, instruction-alignment) to compare the managed block, not the whole file."
acceptanceCriteria:
  - "Init on a repo whose CLAUDE.md has hand-written text and no markers keeps that text and adds the managed block"
  - "Re-init on a file with markers changes only the text between them; text before and after is byte-identical"
  - "AGENTS.md behaves the same way"
  - "Running init twice in a row leaves both files unchanged the second time"
  - "The drift and alignment tests compare the managed block and pass for this repository"
priority: "high"
tags:
  - "core"
  - "init"
  - "assistant-assets"
source: "ndx-capture"
blockedBy:
  - "828e4baa-879a-4674-8420-a7fde376e508"
---
