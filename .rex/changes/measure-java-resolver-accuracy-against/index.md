---
id: "348adc29-0ba6-4b82-b306-000fb8944c3c"
type: "change"
title: "Measure Java resolver accuracy against scip-java"
slug: "measure-java-resolver-accuracy-against"
intent: "Add a script that, for each drift-corpus repository that builds, reads a scip-java index, reduces it to file-to-file reference edges inside the repository, and compares them with the resolver's edges. Report precision, recall and the top unmatched patterns in each direction.\n\nThe operator produces the index outside the agent run: hench's agent session refuses network git commands and the scip-java build needs a JDK, Maven or Gradle and network access. Document the exact commands next to the script (install scip-java, build each corpus repository in ~/.cache/ndx-java-corpus/, write index.scip to a known path). The script reads the corpus and the indexes from that machine-local directory and never clones, builds or downloads anything.\n\nIf the indexes are present, run the comparison and append the numbers and proposed precision and recall thresholds for gate G2 to the rex log. If they are not, write the exact operator commands to the rex log and stop; the operator then runs the comparison and records the numbers.\n\nscip-java, the JDK and Maven or Gradle are not dependencies of n-dx, and the script is not part of the default test run."
acceptanceCriteria:
  - "The script compares resolver edges with a scip-java index and reports precision, recall and the top unmatched patterns"
  - "The operator commands to install scip-java and produce each index are documented next to the script"
  - "The script reads the corpus and indexes from the machine-local directory and never clones, builds or downloads"
  - "The rex log holds either the results per corpus repository with proposed G2 thresholds, or the exact operator commands when the indexes were absent"
  - "Neither scip-java nor a JDK becomes an n-dx dependency, and the script is excluded from the default test run"
touches:
  - "f522e7ae-44aa-458b-80ef-7a1132416c0c"
priority: "medium"
tags:
  - "language-packs"
  - "phase-2"
  - "sourcevision"
  - "java"
  - "tests"
source: "roadmap"
blockedBy:
  - "cc902750-ded4-45eb-b726-5f159d8eca6e"
---
