---
id: "fa43edc7-84c5-48e3-a15f-e815c83f994f"
type: "task"
title: "Keep the sv pack add command out of the docs build's HTML parser"
slug: "keep-the-sv-pack-add-command-out-of"
description: "**must-fix; required check Build & Validate, run 39028377207.** Review: https://github.com/en-dash-consulting/n-dx/pull/825#discussion_r4303693307\n\nAt the #825 head, `docs/packages/sourcevision.md` lines 42–44 hold an inline code span that wraps across lines:\n\n```\nruns `npm install --ignore-scripts --no-audit --no-fund --prefix\n<ndx home>/packs/<sourcevision version> @n-dx/lang-<lang>@<sourcevision version>` (`--dry-run` prints it), then loads\n```\n\nLine 44 begins `<ndx home>/packs/<sourcevision version> …`, and VitePress's Vue compiler reads the placeholders as HTML tags: the build reports `docs/packages/sourcevision.md: Element is missing end tag`, so the docs build fails and Build & Validate with it.\n\nFix: keep the whole command on one line inside the backticks, or move it into a fenced ```sh block after the sentence (the other `<lang>`/`<file>` placeholders already in fenced blocks are fine). Check the rest of the new sv pack section for any other inline placeholder that could land at a line start. Run `pnpm docs:build` locally."
acceptanceCriteria:
  - "pnpm docs:build passes"
  - "The sv pack add command in docs/packages/sourcevision.md reads exactly as the CLI runs it (same flags, placeholders and order)"
  - "No inline code span in the page wraps onto a line that starts with a <placeholder>"
priority: "critical"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Operator note: the hench sandbox refuses `pnpm docs:build`. Verify the docs build with `npx vitepress build docs` from the project root instead; it is the same command (`docs:build` is `vitepress build docs`), and its exit 0 satisfies the \"pnpm docs:build passes\" criterion."}
tags:
  - "review-fixes"
  - "docs"
  - "ci"
  - "pr-21"
source: "review"
---
