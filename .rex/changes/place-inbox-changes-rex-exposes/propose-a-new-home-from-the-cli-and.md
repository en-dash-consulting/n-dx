---
id: "93852535-8174-4ac8-883b-d6f444c2cb46"
type: "task"
title: "Propose a new home from the CLI and MCP: rex change place --propose and place_change propose"
slug: "propose-a-new-home-from-the-cli-and"
description: "Wire `recordProposal` into both surfaces that place changes today.\n\nCLI (`packages/rex/src/cli/commands/change.ts`, `rex change place`): `--propose --type=capability|constraint --under=<area> --title=<text> [--summary=…] [--proposed=<statement>] [--capability-criterion=\"<id>: <text>\" …]`. `--propose` is exclusive with `--target` and `--relation`. Write inside `withPrdModelTransaction`, log a `change_proposed` event to the execution log (detail: type, under, title), and print the result the way a placement prints. Update `cli/help.ts`.\n\nMCP (`packages/rex/src/cli/mcp-tools/place-change.ts`): a `propose` object argument `{ type, under, title, summary?, proposed?, criteria? }`, exclusive with `target`; refuse both together. Return `{ change, proposed: { target, under, title, type } }`. Update the tool description so an assistant knows the option exists when nothing on the shortlist fits.\n\nToday the only workaround is hand-writing an `added` amendment through a policy change and applying it."
acceptanceCriteria:
  - "rex change place <id> --propose … records the proposal and prints it; --format=json returns change and proposed"
  - "--propose with --target or --relation is refused with a hint"
  - "MCP place_change with propose records it; propose with target is refused"
  - "A change_proposed event is appended to the execution log"
  - "CLI help and the MCP tool description name the propose option"
  - "Tests in product-change-v2.test.ts and mcp-product-tools.test.ts cover success and each refusal"
priority: "high"
tags:
  - "inbox-placement"
  - "rex"
source: "ndx-capture"
---
