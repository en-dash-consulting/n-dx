---
id: "7f4713b1-ab9e-4b67-bf59-19b5aa16284a"
type: "task"
title: "Stamp schemaVersion on every sourcevision fact file"
slug: "stamp-schemaversion-on-every"
summary: "Label each analysis file with the version of its shape so readers can tell what they are reading."
description: "Add a `schemaVersion: string` to the top level of imports.json, config.json, outbound.json, readiness.json, components.json and legacy.json (and any other fact file under the analysis directory that lacks one: check packages/sourcevision/src/schema/data-files.ts for the full list), using the same version constant the manifest uses unless a file needs its own. Type it in schema/v1.ts as optional on read so analyses written before this still validate (schema/validate.ts), and required on write. Writers stay canonical (byte-stable output), so the field goes in a fixed position. Do not change any other field name."
acceptanceCriteria:
  - "A fresh analysis writes schemaVersion at the top level of every fact file listed in data-files.ts"
  - "validate.ts accepts fact files with and without schemaVersion"
  - "Two analyses of an unchanged repo produce byte-identical fact files"
  - "A test lists data-files.ts entries and asserts each written file carries schemaVersion"
priority: "high"
tags:
  - "sourcevision"
  - "schema"
source: "ndx-capture"
---
