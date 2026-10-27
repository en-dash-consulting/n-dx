---
id: "a7b15854-0a39-4143-9d4c-066d4b05610b"
type: "capability"
title: "Auto-Persist Self-Heal Recommendations into PRD Without Execution"
slug: "auto-persist-self-heal-recommendations"
statement: "`ndx self-heal` saves its recommendations to the PRD as tagged items, and with `--capture-only` it stops there without starting execution."
criteria: [{"id":"c1","text":"When `ndx self-heal --capture-only` runs, the self-heal command shall run analyze and recommend, then write the recommendations to the PRD as tagged items."},{"id":"c2","text":"When `ndx self-heal --capture-only` runs, the self-heal command shall exit with status 0 without starting any hench run."},{"id":"c3","text":"When `ndx self-heal` runs without `--capture-only`, the self-heal command shall write the recommendations to the PRD before it starts execution."},{"id":"c4","text":"When `ndx self-heal` runs without `--capture-only`, the self-heal command shall carry out its existing analyze, recommend and execute behaviour from start to finish."},{"id":"c5","text":"When `ndx self-heal --help` runs, the CLI shall describe `--capture-only` and explain how capturing recommendations differs from executing them."}]
source: "smart-add"
---

Currently `ndx self-heal` generates recommendations and immediately begins acting on them. Users want the recommendations captured into the PRD as tagged items so they remain visible and triageable, while decoupling capture from execution. This makes self-heal usable as a planning/audit step in addition to an autonomous loop.
