---
id: "66cd459f-dc77-4f8f-aa8e-7936cfc242b8"
type: "task"
title: "Extensions declare a Sidecar drawer tab, and the hub API reports it per project"
slug: "extensions-declare-a-sidecar-drawer"
description: "Story 50a (contract half, part 1 of 3; Sidecar design §17.1). Add an optional sidecarTab: { label, path } to the ndx.extension manifest, next to projectLinks, in packages/core/extension-manifest.js and extension-manifest.schema.json (projectLinks is the model: same {projectId} and {repoRoot} placeholders, path starts with /, resolves under /x/<name>/; needs the sidecar block under the needs-sidecar rule). apiVersion stays 1. In packages/web/src/hub/extensions.ts, with ?project=<id> each ExtensionView gains tab: { label, url } | null beside links, url resolved with resolveProjectLink. Docs: docs/extensions/manifest.md and docs/extensions/hub-api.md; note that n-dx releases before this one refuse the field as unknown-field and list the extension invalid, so an extension using it should set ndxVersion to this release or later. Escape {projectId} and {repoRoot} for VitePress as the existing docs do. Core is plain JS and changes through its own tests; nothing else in core imports package code."
acceptanceCriteria:
  - "The validator accepts sidecarTab { label, path } and the schema matches it; apiVersion stays 1"
  - "Tests show the validator refusing a tab without a sidecar block (needs-sidecar), an unknown key inside the tab, a path that does not start with /, an unknown placeholder, and an empty label"
  - "With ?project=<id>, each entry of GET /api/hub/extensions has tab: { label, url } with the placeholders URL-encoded under /x/<name>/, and tab is null unless the extension is enabled, compatible and has a sidecar; without ?project there is no tab field. packages/web/tests/integration/hub-extension-api.test.ts covers both"
  - "docs/extensions/manifest.md and hub-api.md document the field, the per-entry tab and the older-n-dx caveat, and the docs build passes with the placeholders escaped"
priority: "high"
source: "caos"
---
