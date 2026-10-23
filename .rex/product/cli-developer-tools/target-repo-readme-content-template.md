---
id: "2fa57d4b-f582-49b9-b606-80c948fd1961"
type: "capability"
title: "Target-Repo README Content Template with Required Sections"
slug: "target-repo-readme-content-template"
statement: "When ndx init generates README.md for a repository without a README, or README.proposed.md beside an existing one, it writes Overview, Quick Start, Testing and License sections in that order, filled from project signals or from stubs when those signals are absent."
criteria: [{"id":"c1","text":"When ndx init generates README.md, the generator shall write an ## Overview section populated from the package.json description or the project summary."},{"id":"c2","text":"When ndx init generates README.md, the generator shall write a ## Quick Start section containing at least an install command derived from the project's package manager."},{"id":"c3","text":"When ndx init generates README.md, the generator shall write a ## Testing section listing the detected test command."},{"id":"c4","text":"If no test command is detected, the generator shall write a non-empty placeholder in the ## Testing section."},{"id":"c5","text":"When ndx init generates README.md, the generator shall write a ## License section citing the license from package.json."},{"id":"c6","text":"If package.json has no license field, the generator shall write 'See LICENSE' in the ## License section."},{"id":"c7","text":"When ndx init generates README.proposed.md for a repository with an existing README, the generator shall write the Overview, Quick Start, Testing and License sections under the same headings as README.md."},{"id":"c8","text":"The generator shall order the sections Overview, Quick Start, Testing, License in both README.md and README.proposed.md."}]
source: "smart-add"
---

Update the content template used by ndx init when generating README.md (no existing README) and README.proposed.md (existing README present) to guarantee the four required sections: Overview, Quick Start, Testing, and License. Currently the generated content may omit or inconsistently format these sections.
