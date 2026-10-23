---
id: "9ad5fad2-5ee5-44dd-9fa8-efcf2a09d910"
type: "capability"
title: "Stewards and code-owner files"
slug: "stewards-and-code-owner-files"
statement: "The product reads stewards (git emails or GitHub team handles) from the product layer and, when the project opts in, generates a GitHub CODEOWNERS file and a Bitbucket .bitbucket/CODEOWNERS file that map each area folder to its stewards."
criteria: [{"id":"c1","text":"The system shall read the stewards list on the root product index as the default stewards for every area."},{"id":"c2","text":"When an area declares its own stewards list, the system shall use that list instead of the root list for that area's folder."},{"id":"c3","text":"The system shall accept each stewards entry as a plain string that is either a git email or a GitHub-style team handle of the form @org/team."},{"id":"c4","text":"When code-owner generation is enabled, the generator shall write both CODEOWNERS (GitHub) and .bitbucket/CODEOWNERS (Bitbucket) from the same stewards list."},{"id":"c5","text":"The generator shall write one rule per product-layer area folder in each code-owner file."},{"id":"c6","text":"The generator shall write steward email entries into both the GitHub and the Bitbucket code-owner files."},{"id":"c7","text":"The generator shall write @org/team handles into the GitHub code-owner file only and omit them from the Bitbucket code-owner file."},{"id":"c8","text":"When the generator omits a team handle from the Bitbucket code-owner file, the generator shall print a warning naming each omitted handle."},{"id":"c9","text":"If the project has not turned on code-owner generation, the system shall generate no code-owner files."},{"id":"c10","text":"When a stewards list changes, the generator shall regenerate the code-owner files."},{"id":"c11","text":"The generator shall emit no code-owner rule that matches a path outside the product-layer area folders, so that touches-only changes match no code-owner rule."}]
tags:
  - "product-map"
  - "pr-25"
  - "lane-core-docs"
  - "rex"
  - "core"
source: "roadmap"
priority: "medium"
---

Stewards are declared in the product layer and enforced through each host's code-owner file. Git email is the identity.

Roadmap PR 25 · wave 3 · lane core-docs.
