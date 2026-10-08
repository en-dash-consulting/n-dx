---
id: "348adc29-0ba6-4b82-b306-000fb8944c3c"
level: "task"
title: "Measure Java resolver accuracy against scip-java"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "phase-2"
  - "sourcevision"
  - "java"
  - "tests"
blockedBy:
  - "cc902750-ded4-45eb-b726-5f159d8eca6e"
source: "roadmap"
acceptanceCriteria:
  - "The script compares resolver edges with a scip-java index and reports precision, recall and the top unmatched patterns"
  - "The steps to produce the scip-java index are documented next to the script"
  - "The rex log holds either the results per corpus repository with proposed G2 thresholds, or the exact commands the operator must run because scip-java or a JDK was unavailable"
  - "Neither scip-java nor a JDK becomes an n-dx dependency, and the script is excluded from the default test run"
description: "Add a script that, for each drift-corpus repository that builds, reads a scip-java index (produced by running scip-java manually with the documented command, JDK and build tool), reduces it to file-to-file reference edges inside the repository, and compares them with the resolver's edges. Report precision, recall and the top unmatched patterns in each direction.\n\nscip-java, the JDK and Maven or Gradle are needed only to run this measurement; they are not dependencies of n-dx and the script is not part of the default test run. If they are available, run it and append the numbers and proposed precision and recall thresholds for gate G2 to the rex log; if they are not, say so in the log and leave the run to the operator, with the exact commands."
lastModified: "2026-10-08T00:04:16.904Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
