---
id: "2de56583-708e-4be1-ad56-ec7d35772591"
type: "task"
title: "One rule for missing opt-in packs: warn only when something asked for is broken, else one end-of-run hint"
slug: "one-rule-for-missing-opt-in-packs-warn"
description: "Ryan's decision (2026-10-16, stack review #780 and #771): one rule for missing opt-in packs, across Terraform, Java and Python.\n- **Warn** only when something the project asked for is broken: the pack is listed in .n-dx.json sourcevision.packs but missing, or an installed pack is refused (version mismatch), invalid, or failed while running. These warnings stay as they are today.\n- **Hint** otherwise. A pack that would help this repo but is neither listed nor installed gets no per-language warning. Instead, analyze prints one info line at the end of the run naming every such pack, e.g. `Optional packs for this repo: terraform, java — ndx sv pack add <id>`. It is printed once per analyze, not per phase, and not at all when there is nothing to suggest.\n- **Go** keeps its current behaviour: its pack is a default optional dependency with a regex fallback, so a missing Go pack still means the install went wrong.\n\nWhere:\n- packages/sourcevision/src/analyzers/terraform-infrastructure.ts, around line 125: the skip() path that warns `Terraform: pack @n-dx/lang-terraform is not installed…` whenever data.resources has a .tf resource. A missing, unlisted Terraform pack feeds the hint instead. Update terraform-infrastructure.test.ts:253, which encodes the old warning.\n- packages/sourcevision/src/analyzers/pack-imports.ts buildPackImportGraph's degrade path, for Java and Python: the `… files get inventory only … install it with …` warning becomes a hint when the pack is missing and unlisted.\n- The end-of-run line goes where analyze prints its summary (cli/commands/analyze.ts). Collect the ids through the analyze context, so each phase only records them.\n\nOnly console output changes; every analysis artifact stays byte-identical. The session verifies this on the corpus. Tests cover: unlisted missing pack (hint, no warning); listed missing pack (warning); mismatched pack (warning); Go missing (unchanged); several packs, giving one combined line; and nothing to suggest, giving no line."
acceptanceCriteria:
  - "An unlisted, missing Terraform, Java or Python pack produces no per-language warning and appears in one end-of-run 'Optional packs for this repo' line"
  - "A listed-but-missing, refused or invalid pack still warns; Go's behaviour is unchanged"
  - "Analysis artifacts unchanged; tests cover every case listed"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Ryan decided this rule on 2026-10-16 (#780 and #771 threads); implement it as written. The hench sandbox may block the network and ~/.cache corpora. If it does, leave the corpus and byte-identity checks to the session; do not capture follow-ups for them."}
tags:
  - "review-fixes"
  - "sourcevision"
  - "decision"
  - "pr-17"
source: "review"
---
