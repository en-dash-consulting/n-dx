---
id: "a0f3e3b7-2d4c-4727-90ff-410765cb9087"
type: "task"
title: "Generate a README on init only with --readme, and never point at a missing file"
slug: "generate-a-readme-on-init-only-with"
summary: "Init stops adding a placeholder README unless asked, and a generated one never mentions a LICENSE file that is not there."
description: "generateTargetReadme (packages/core/readme-generator.js) runs on every init (packages/core/cli.js, before the assistant artifacts) and writes README.md, or README.proposed.md beside an existing README. Make it opt-in behind `ndx init --readme`; without the flag, init writes neither file and the init summary says nothing about a README. When it does generate, the License section names the manifest's license when there is one, says \"See LICENSE\" only when a LICENSE (or LICENSE.md / LICENSE.txt / COPYING) file exists, and otherwise omits the section. Update `ndx init --help` (packages/core/help.js), the command-effects table (packages/core/command-effects.js, which lists README.md as an init effect) and git-preflight's list (README.proposed.md) to match."
acceptanceCriteria:
  - "ndx init without --readme in a repo with no README writes no README.md and no README.proposed.md"
  - "ndx init --readme writes the README as before"
  - "A generated README in a repo with no license field and no LICENSE-like file has no License section and no 'See LICENSE' text"
  - "ndx init --help lists --readme, and the command-effects table lists the README only under that flag"
  - "Existing readme-generator tests are updated and pass"
priority: "medium"
tags:
  - "core"
  - "init"
  - "readme"
source: "ndx-capture"
---
