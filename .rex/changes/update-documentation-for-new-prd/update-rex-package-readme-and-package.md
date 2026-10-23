---
id: "8894ca28-c09b-4fb7-a704-cde878a0990f"
type: "task"
title: "Update rex package README and PACKAGE_GUIDELINES for markdown-first storage"
slug: "update-rex-package-readme-and-package"
description: "Update packages/rex/README.md to document the new markdown storage format with a Storage section covering the schema overview, dual-write behavior, and migration path. Update PACKAGE_GUIDELINES.md and TESTING.md wherever prd.json file format or storage conventions are referenced to reflect the markdown-primary model."
acceptanceCriteria:
  - "packages/rex/README.md contains a Storage section documenting prd.md as primary, dual-write to prd.json, and the automatic migration path"
  - "PACKAGE_GUIDELINES.md updated to reference prd.md wherever prd.json storage format is discussed"
  - "TESTING.md updated if any test guidance references prd.json as the file to inspect or seed"
  - "Migration path is clearly described: automatic on first load, or manual via `rex migrate-to-md`"
  - "README documents how to read and manually edit prd.md, including which fields are required vs optional"
priority: "medium"
tags:
  - "docs"
  - "rex"
source: "smart-add"
---
