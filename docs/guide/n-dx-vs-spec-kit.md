# n-dx vs Spec Kit

The 2026 spec-driven development lists name GitHub Spec Kit, OpenSpec, AWS Kiro, and BMAD. They do not name n-dx. That is a discovery gap, not a ranking.

n-dx.dev already compares itself to coding agents (Claude Code, Aider, OpenHands, Goose, MetaGPT, 8090, Devin). Spec Kit, OpenSpec, and Kiro are the spec layer people now evaluate first. This page is that comparison.

No invented star counts for the other tools. Licenses and product shapes below are from public docs as of 21 Aug 2026. Where we have not verified a file, we say so.

## The difference that matters

Spec Kit, OpenSpec, and Kiro start from intent you write down: specify, plan, task, implement. That is the right loop when you already know what to build.

n-dx starts from the repo. sourcevision maps files, imports, and architectural zones. rex turns findings into a living PRD. hench executes the next task. You can still add work in plain language:

```sh
ndx add "Add SSO support" .
```

The default path is what is already here, and what to fix or finish.

If the last six months were vibe-coded, use the [vibe-cleanup guide](./vibe-cleanup).

## Four tools, four jobs

**GitHub Spec Kit** is a portable MIT toolkit. Install `specify-cli`, write a constitution, then specify, plan, task, and implement through the agent you already use (Copilot, Claude Code, Gemini, Cursor, and others). Specs are markdown in the repo. GitHub documents existing-project adoption. 2026 writeups still treat it as structured and often greenfield-leaning.

**OpenSpec** (Fission-AI) is a lightweight CLI built brownfield-first. Changes are deltas (ADDED, MODIFIED, REMOVED) against a source-of-truth spec. The loop is propose, apply, archive. You spec the slice you are changing. It does not scan a repo into a PRD. License is commonly cited as MIT; confirm the LICENSE file.

**AWS Kiro** is an agentic IDE, not a CLI you add to an existing editor. A prompt becomes requirements, design, and tasks, then its agents implement. Typical files: `requirements.md`, `design.md`, `tasks.md`. Commercial AWS product. Formal requirement checks and Agent Hooks are on the public pitch. The workflow lives in Kiro.

**n-dx** is a CLI-first toolkit from En Dash. Install `@n-dx/core`, then `ndx analyze`, `ndx recommend`, `ndx work`, and `ndx start`. Built for Claude Code and Codex. PRD in `.rex/`. Rex and SourceVision expose MCP. License is Elastic 2.0 (source-available, not OSI). Hosted-service limits differ from MIT. GitHub listed 16 stars on 21 Aug 2026.

## Comparison

Qualitative rows stay as words. "Unknown" means we have not verified it from public docs.

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

The useful claim is that the spec can be regenerated from the tree.

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

The PRD is living because it is derived from the code and updated when the code changes.

## Who should pick which

**Pick Spec Kit** if you want the portable SDD workflow most teams already recognize, you switch agents, and you will write the spec before the code. MIT is what most open-source buyers expect.

**Pick OpenSpec** if you are changing an existing system one slice at a time and want a thin delta layer, not a codebase analyzer or a full PRD tree.

**Pick Kiro** if you want SDD inside an IDE, you are fine on AWS, and you want agent, editor, and spec as one product.

**Pick n-dx** if the repo already exists, the plan has drifted from the code, or a prototype became production without a spec. Analyze the tree, keep a PRD that can be re-derived, then execute. Having people on that repo with you is consulting, not a CLI flag.

## When not to pick n-dx

Do not pick n-dx if you need a large community, an OSI-approved license, or an agent-agnostic install. Those are real gaps.

| Gap | What that means |
|-----|-----------------|
| OSI-approved license | The code is public. The license is Elastic 2.0, not MIT. ELv2 allows internal use, modification, and distribution, with a hosted-service restriction. The precise term is source-available. |
| Large community | n-dx listed 16 GitHub stars on 21 Aug 2026. Spec Kit, OpenSpec, and Kiro are the names in the 2026 lists. |
| Agent-agnostic install | n-dx is built for Claude Code and Codex. Spec Kit and OpenSpec ride whatever agent you already use. |

## Get started

The package is `@n-dx/core`. Then run the loop against a directory:

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
Same category, different start. Spec Kit is spec-first and agent-portable. n-dx is codebase-first and built for Claude Code and Codex. Choose from the jobs above, not from invented checkmarks.

**Why is n-dx missing from Spec Kit vs OpenSpec vs Kiro lists?**
The 2026 roundups at Levelop, Augment Code, and thebcms name Spec Kit, OpenSpec, Kiro, and BMAD. n-dx is smaller and newer (16 GitHub stars on 21 Aug 2026). Absence from a list is not a quality score.

**Can I use n-dx on a greenfield repo?**
Yes. Quickstart covers an empty project. The product is aimed at existing systems. A blank folder that wants specify, plan, tasks will feel more at home in Spec Kit or Kiro.

**Is n-dx open source the way Spec Kit is?**
The code is public. The license is Elastic 2.0, not MIT. ELv2 allows internal use, modification, and distribution, with a hosted-service restriction. Spec Kit is MIT. OpenSpec is commonly cited as MIT; confirm the LICENSE file. "Open source" on the marketing site is informal. The precise term is source-available.

Related guides: [Spec-Driven Development](./spec-driven) (spec file to executing agent), [Existing Project Onboarding](./existing-project) (brownfield first run), [Cleaning Up a Vibe-Coded App](./vibe-cleanup) (when the last six months were vibe-coded).
