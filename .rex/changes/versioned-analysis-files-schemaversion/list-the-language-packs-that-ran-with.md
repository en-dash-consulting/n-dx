---
id: "90605ac0-4321-4bc1-b0de-85f3935daa39"
type: "task"
title: "List the language packs that ran, with their versions, in manifest.json"
slug: "list-the-language-packs-that-ran-with"
summary: "Record in the analysis which language packs produced it and at what version."
description: "Add `packs?: Array<{ id: string; version: string }>` to Manifest (packages/sourcevision/src/schema/v1.ts), written by analyzers/manifest.ts from the packs lang-runtime actually loaded and ran for this analysis (not every installed pack), sorted by id for stable output. The version is the pack package's version. Optional on read for older manifests."
acceptanceCriteria:
  - "An analysis of a PHP fixture with @n-dx/lang-php resolved lists { id: 'php', version: <lang-php's package version> } in manifest.packs"
  - "An analysis of a repo with no PHP has no php entry"
  - "packs is sorted by id and two runs of an unchanged repo give identical manifests apart from the existing timestamp fields"
  - "validate.ts accepts manifests with and without packs"
priority: "medium"
tags:
  - "sourcevision"
  - "schema"
  - "lang-packs"
source: "ndx-capture"
---
