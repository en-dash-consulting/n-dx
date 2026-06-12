# Open Source Scope

n-dx is source-available under the [Elastic License 2.0](LICENSE) (ELv2). The
full source for all packages is published at
<https://github.com/en-dash-consulting/n-dx>. ELv2 grants broad use rights with
one restriction: you may not offer the software (or a substantially similar
product) as a hosted or managed service to third parties.

## Included packages

All six packages in this monorepo are covered by ELv2:

| Package | npm name | Description |
|---------|----------|-------------|
| `packages/core` | `@n-dx/core` | CLI orchestrator (`ndx` / `n-dx`) |
| `packages/sourcevision` | `@n-dx/sourcevision` | Static analysis engine |
| `packages/rex` | `@n-dx/rex` | PRD management and task tracking |
| `packages/hench` | `@n-dx/hench` | Autonomous agent execution |
| `packages/llm-client` | `@n-dx/llm-client` | Vendor-neutral LLM foundation |
| `packages/web` | `@n-dx/web` | Dashboard and MCP HTTP server |

## Excluded from this repository

The following components are proprietary and not included:

- Backend services (billing, authentication, team collaboration)
- Cloud-hosted agent infrastructure
- Internal analytics pipelines

## Contribution expectations

Contributions are welcome. By submitting a pull request you agree that your
contribution will be distributed under the same [Elastic License 2.0](LICENSE)
that covers this project.

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, workflow, and code-style
requirements.

## Questions

Open an issue on GitHub or email the maintainers at the address in
[`package.json`](packages/core/package.json).

---

> **Note:** This file describes the scope at a point in time. The sibling
> document [CONTRIBUTING.md](CONTRIBUTING.md) is the authoritative guide for
> contributors.
