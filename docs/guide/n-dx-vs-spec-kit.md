# n-dx vs Spec Kit

If you searched Spec Kit vs OpenSpec vs Kiro, you probably never saw n-dx. The 2026 lists name those three plus BMAD. We're smaller: 16 GitHub stars as of 21 Aug 2026. That's why this page exists.

n-dx.dev already compares coding agents (Claude Code, Aider, OpenHands, Goose, MetaGPT, 8090, Devin). Spec Kit, OpenSpec, and Kiro are the spec layer people look at first.

Licenses and product shapes below are from public docs as of 21 Aug 2026. We didn't invent numbers for the other tools. If we haven't checked a file, we say so.

## The difference that matters

Spec Kit, OpenSpec, and Kiro start with a spec you write: specify, plan, task, implement. That's the right loop when you already know what to build.

n-dx starts with the repo. sourcevision maps files, imports, and architectural zones. rex turns findings into a living PRD. hench runs the next task. You can still add work in plain language:

```sh
ndx add "Add SSO support" .
```

The default path is what's already here, and what to fix or finish.

If the last six months were vibe-coded, use the [vibe-cleanup guide](./vibe-cleanup).

## What each one actually does

**GitHub Spec Kit** is a portable MIT toolkit. Install `specify-cli`, write a constitution, then specify, plan, task, and implement through the agent you already use (Copilot, Claude Code, Gemini, Cursor, and others). Specs are markdown in the repo. GitHub documents existing-project adoption. 2026 writeups still treat it as structured and often greenfield-leaning.

**OpenSpec** (Fission-AI) is a lightweight CLI built brownfield-first. Changes are deltas (ADDED, MODIFIED, REMOVED) against a source-of-truth spec. The loop is propose, apply, archive. You spec the slice you are changing. It does not scan a repo into a PRD. License is commonly cited as MIT; confirm the LICENSE file.

**AWS Kiro** is an agentic IDE, not a CLI you add to an existing editor. A prompt becomes requirements, design, and tasks, then its agents implement. Typical files: `requirements.md`, `design.md`, `tasks.md`. Commercial AWS product. Formal requirement checks and Agent Hooks are on the public pitch. The workflow lives in Kiro.

**n-dx** is a CLI-first toolkit from En Dash. Install `@n-dx/core`, then `ndx analyze`, `ndx recommend`, `ndx work`, and `ndx start`. Built for Claude Code and Codex. PRD in `.rex/`. Rex and SourceVision expose MCP. License is Elastic 2.0 (source-available, not OSI). Hosted-service limits differ from MIT. GitHub listed 16 stars on 21 Aug 2026.

## Comparison

Rows stay as words. "Unknown" means we haven't verified it from public docs.

| | n-dx | Spec Kit | OpenSpec | Kiro |
|---|---|---|---|---|
| Form | CLI plus optional dashboard | CLI plus agent slash commands | CLI | Agentic IDE |
| License | Elastic 2.0 | MIT | MIT (commonly cited) | AWS commercial |
| Starts from | Existing codebase scan | Spec and constitution | Change delta | Prompt to spec set |
| Living spec | Rex PRD, re-analyzed each cycle | Markdown artifacts. Code auto-sync: unknown | Archive merges deltas into the source-of-truth spec | Spec then implement. Code auto-sync: unknown |
| Static analysis | SourceVision: files, imports, zones, React catalog | Not the product | Not the product | Not the product pitch |
| Execution | Hench tool-use loop | `/speckit.implement` via your agent | Apply via your agent | Built-in agents |
| Agents | Claude Code and Codex | Many (Copilot, Claude, Gemini, Cursor, others) | Agent-agnostic | Built-in |
| 2026 SDD roundups | Not named | Named | Named | Named |

The 2026 SDD roundups cited are Levelop, Augment Code, and thebcms.

## How the n-dx loop stays current

The spec can be rebuilt from the tree. That's the point.

```sh
ndx analyze .
ndx recommend .
ndx work .
ndx self-heal
```

1. `ndx analyze .` runs sourcevision and writes AI-readable context (`.sourcevision/CONTEXT.md`).
2. `ndx recommend .` proposes epics and tasks from findings. You accept or reject them.
3. `ndx work .` (or `--auto`) has hench pick the next task, brief it with codebase context, and execute.
4. `ndx self-heal` re-analyzes, recommends, executes, and acknowledges completed findings so they do not regenerate. Fuzzy matching covers renames.

The PRD stays current because it is derived from the code and updated when the code changes.

## Who should pick which

**Pick Spec Kit** if you'll write the spec before the code, you switch agents, and you want the portable SDD workflow most teams already recognize. MIT is what most open-source buyers expect.

**Pick OpenSpec** if you're changing an existing system one slice at a time and want a thin delta layer, not a codebase analyzer or a full PRD tree.

**Pick Kiro** if you want SDD inside an IDE, you're fine on AWS, and you want agent, editor, and spec as one product.

**Pick n-dx** if the repo already exists, the plan drifted from the code, or a prototype became production without a spec. Analyze the tree, keep a PRD that can be re-derived, then execute. Having people on that repo with you is consulting, not a CLI flag.

## When not to pick n-dx

Skip n-dx if you need a large community, an OSI-approved license, or an agent-agnostic install. Those are real gaps.

| Gap | What that means |
|-----|-----------------|
| OSI-approved license | The code is public. The license is Elastic 2.0, not MIT. ELv2 allows internal use, modification, and distribution, with a hosted-service restriction. The precise term is source-available. |
| Large community | n-dx listed 16 GitHub stars on 21 Aug 2026. Spec Kit, OpenSpec, and Kiro are the names in the 2026 lists. |
| Agent-agnostic install | n-dx is built for Claude Code and Codex. Spec Kit and OpenSpec ride whatever agent you already use. |

## Get started

Install `@n-dx/core`, then run the loop against a directory:

```sh
ndx init .
ndx analyze .
ndx recommend .
ndx work .
ndx start
```

See [Getting Started](./getting-started) for install options and [Existing Project Onboarding](./existing-project) for a brownfield first run.

- Product: [n-dx.dev](https://n-dx.dev)
- Marketing comparison: [n-dx.dev/vs/spec-kit/](https://n-dx.dev/vs/spec-kit/)
- Repo: [github.com/en-dash-consulting/n-dx](https://github.com/en-dash-consulting/n-dx)
- Toolkit listing: [endash.us/toolkit/items/n-dx](https://endash.us/toolkit/items/n-dx)

## FAQ

**Is n-dx a Spec Kit alternative?**
Kind of. Spec Kit starts from a spec you write and works with a lot of agents. n-dx starts from the repo and is built for Claude Code and Codex. Use the jobs above.

**Why is n-dx missing from Spec Kit vs OpenSpec vs Kiro lists?**
The 2026 roundups at Levelop, Augment Code, and thebcms name Spec Kit, OpenSpec, Kiro, and BMAD. n-dx is smaller and newer (16 GitHub stars on 21 Aug 2026).

**Can I use n-dx on a greenfield repo?**
Yes. Quickstart works on an empty folder. The tool is built for repos that already have code. If you're starting from a blank spec, Spec Kit or Kiro will feel more natural.

**Is n-dx open source the way Spec Kit is?**
The code is public. The license is Elastic 2.0, not MIT. ELv2 allows internal use, modification, and distribution, with a hosted-service restriction. Spec Kit is MIT. OpenSpec is commonly cited as MIT; confirm the LICENSE file. "Open source" on the marketing site is informal. The precise term is source-available.

Related guides: [Spec-Driven Development](./spec-driven) (spec file to executing agent), [Existing Project Onboarding](./existing-project) (brownfield first run), [Cleaning Up a Vibe-Coded App](./vibe-cleanup) (when the last six months were vibe-coded).
