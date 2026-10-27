---
id: "9d98c55f-8115-4b25-963c-0b1f9c9d0da0"
type: "task"
title: "List Python in inventory analysedLanguages when the Python pack loads"
slug: "list-python-in-inventory"
description: "With 98b93b54, Python files get import edges and zones when @n-dx/lang-python loads, but `analyzers/inventory.ts` still leaves Python out of `summary.analysedLanguages`, because the inventory phase runs before the imports phase and does not know whether the pack will load. The web's language-analysis strip therefore shows Python as not analysed even when it was. Listing it unconditionally would change inventory.json for Python repositories without the pack, which the byte-identical bar forbids. Options: have analyze patch the summary after the imports phase when the Python pack produced facts, or have the inventory ask the pack loader (cheap: loadPack without running it). Keep inventory.json byte-identical without the pack."
acceptanceCriteria:
  - "With the Python pack loaded, analysedLanguages lists Python for a Python repository"
  - "Without the pack, inventory.json is byte-identical to before"
priority: "low"
tags:
  - "language-packs"
  - "lang-python"
  - "sourcevision"
  - "pr-15"
source: "discovered"
---
