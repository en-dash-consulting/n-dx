---
id: "90989978-1e8a-42cf-873f-74da53bf6c72"
type: "change"
title: "Update README generation template to include Overview, Quick Start, Testing, and License sections"
slug: "update-readme-generation-template-to"
intent: "Author a content template for the ndx-init-generated README that guarantees presence of Overview, Quick Start, Testing, and License sections in that order. Each section should be populated from available project signals (package.json description, detected test command, license field) with sensible stubs when signals are absent. The template must be applied by both the README.md (empty-repo) and README.proposed.md (existing-README) generation paths."
acceptanceCriteria:
  - "Generated README.md contains an ## Overview section populated from package.json description or project summary"
  - "Generated README.md contains a ## Quick Start section with at minimum an install command derived from the project package manager"
  - "Generated README.md contains a ## Testing section listing the detected test command or a placeholder if none is detected"
  - "Generated README.md contains a ## License section citing the license from package.json or falling back to 'See LICENSE'"
  - "README.proposed.md contains all four sections under the same headings"
  - "Section order is Overview → Quick Start → Testing → License in both output files"
touches:
  - "2fa57d4b-f582-49b9-b606-80c948fd1961"
priority: "high"
tags:
  - "init"
  - "readme"
  - "cli"
source: "smart-add"
---
