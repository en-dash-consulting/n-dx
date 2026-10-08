---
id: "42d5dba1-28f7-4a46-876f-7b887ddbe759"
level: "task"
title: "Seed the Go drift corpus and measure parse rate and import parity"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "go"
  - "sourcevision"
  - "tests"
  - "pr-6"
blockedBy:
  - "f817ad86-dc1b-481b-986e-77b48323d286"
source: "roadmap"
acceptanceCriteria:
  - "The corpus list pins gitea and microservices-demo by commit SHA"
  - "The report prints clean-parse share and import parity per repository, or the clone command when a checkout is missing"
  - "Results are in the rex log; at least 98% of .go files parse cleanly, or the failing constructs are listed"
  - "The scripts are excluded from the default test run"
  - "The six static root policy tests pass"
description: "The operator has cloned the corpus (shallow) into ~/.cache/ndx-go-corpus/. Pin exactly:\n- gitea: https://github.com/go-gitea/gitea.git @ 89ec271d9c5bfd15bbf1a4780b96993296439ab0 (3131 .go files)\n- microservices-demo: https://github.com/GoogleCloudPlatform/microservices-demo.git @ 38e7348eb289eb5b87c0c6e8cb19ced0449dc389 (4 Go modules)\n\nFollow the Java corpus scripts (java-corpus.json, the operator-run clone script, the report script); generalise them per language if that is cleaner than copying. The agent never clones or fetches: if a checkout is missing, print the clone command, write it to the rex log and stop. The report gives the clean-parse share per repository and import parity: for each file, compare the import paths captured by the Go pack with those from the regex parser, and list the files that differ and why. Gate: at least 98% clean parse. Append the results to the rex log."
lastModified: "2026-10-08T03:08:50.556Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
