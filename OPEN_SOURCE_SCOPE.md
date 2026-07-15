# Open Source Scope

This document defines the boundaries of the open (source-available) n-dx
project: what is included, what is excluded, the licensing terms that apply,
and what is expected of contributors. It is the authoritative reference for
"is this part of the project?" questions.

n-dx is **source-available** under the [Elastic License 2.0](LICENSE) (ELv2).
It is published in full at
<https://github.com/en-dash-consulting/n-dx> by En Dash Consulting. ELv2 grants
broad rights to use, copy, modify, and redistribute the software, with a small
number of limitations described under [Licensing boundaries](#licensing-boundaries).

> **"Open source" vs. "source-available."** ELv2 is not an OSI-approved open
> source license. We use "open source" informally to mean the code is public
> and freely usable; the precise terms are ELv2, and the hosted-service
> limitation below is the one meaningful difference from a permissive license.

---

## Included components

Everything in this repository is covered by ELv2 and published to npm under the
`@n-dx/` scope. All six packages share a single version line and are released
together.

| Package | npm name | License | Description |
|---------|----------|---------|-------------|
| `packages/core` | `@n-dx/core` | Elastic-2.0 | CLI orchestrator — the `ndx` / `n-dx` command that spawns the other tools |
| `packages/sourcevision` | `@n-dx/sourcevision` | Elastic-2.0 | Static analysis engine (file inventory, import graph, zone detection) |
| `packages/rex` | `@n-dx/rex` | Elastic-2.0 | PRD management and hierarchical task tracking |
| `packages/hench` | `@n-dx/hench` | Elastic-2.0 | Autonomous agent execution loop |
| `packages/llm-client` | `@n-dx/llm-client` | Elastic-2.0 | Vendor-neutral LLM foundation (Claude/Codex adapters) |
| `packages/web` | `@n-dx/web` | Elastic-2.0 | Dashboard and MCP HTTP server |

Also included and covered by ELv2:

- **All source, tests, and build tooling** — `packages/*/src`, `tests/`,
  `scripts/`, and the monorepo build/CI configuration.
- **Documentation** — `README.md`, `docs/`, `documentation/`, and the
  package-level guidance files (`CLAUDE.md`, `AGENTS.md`, `PACKAGE_GUIDELINES.md`,
  `TESTING.md`, `ZONES.md`, `CONTRIBUTING.md`).
- **Assistant assets** — `packages/core/assistant-assets/` (the shared source
  for generated `AGENTS.md` / `CLAUDE.md` / Codex config).
- **The MCP servers** exposed by rex and sourcevision (both stdio and HTTP
  transports) and the dashboard served by `@n-dx/web`.

You may run all of this locally, in CI, and inside your own organization —
including on private code — with no additional grant required.

---

## Excluded / proprietary components

The following are **not** part of this repository and are **not** covered by
ELv2. They are proprietary to En Dash Consulting and, where offered, are
governed by separate commercial terms:

- **Hosted / managed n-dx service** — any cloud-hosted, multi-tenant offering
  that provides n-dx functionality as a service.
- **Backend services** — billing, authentication, account and team-collaboration
  infrastructure.
- **Cloud-hosted agent infrastructure** — remote execution environments for
  running hench agents at scale.
- **Internal analytics and telemetry pipelines** — usage aggregation systems
  that are not part of the local dashboard.
- **Branding assets beyond permitted use** — the n-dx name and logos are
  trademarks; see [Trademarks](#trademarks).

If a capability is not present in this repository's source tree, treat it as
out of scope for the open project. Contributions that assume access to these
proprietary systems cannot be merged.

---

## Licensing boundaries

The complete terms are in [LICENSE](LICENSE). In summary, under ELv2 you **may**:

- Use the software for any purpose, commercial or non-commercial.
- Copy, modify, and create derivative works.
- Distribute the software and your modifications.
- Use it internally within your company, including on proprietary codebases.

You **may not**:

- **Offer the software as a hosted or managed service** to third parties where
  that service exposes a substantial set of n-dx's features or functionality.
  This is the single meaningful restriction that distinguishes ELv2 from a
  permissive license.
- Move, change, disable, or circumvent any license-key functionality.
- Remove or obscure any licensing, copyright, or other notices.

Additional obligations:

- **Pass-through of terms** — anyone you give a copy to must also receive the
  ELv2 terms.
- **Modification notice** — modified copies must carry prominent notices stating
  that you changed the software.

If you want to build a hosted product on top of n-dx, or your intended use may
fall on the wrong side of the hosted-service limitation, contact the maintainers
to discuss a commercial arrangement before shipping.

### Third-party dependencies

Runtime and build dependencies retain their own upstream licenses (MIT, Apache-2.0,
ISC, etc.) and are **not** relicensed under ELv2. ELv2 applies to the n-dx source
in this repository, not to the packages it depends on. Review each dependency's
license independently if you redistribute a bundled build.

---

## Contribution expectations

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full
setup, workflow, testing, and commit conventions — that document is the
authoritative guide for *how* to contribute. This section covers the licensing
and scope expectations.

- **Inbound = outbound.** By submitting a pull request you agree that your
  contribution is licensed under the same [Elastic License 2.0](LICENSE) that
  covers the project. Do not contribute code you are not entitled to license
  under these terms.
- **Stay within scope.** Contributions must target the components in this
  repository. Features that depend on the excluded/proprietary systems above
  cannot be merged.
- **Respect the architecture.** n-dx enforces a four-tier dependency hierarchy,
  gateway modules, and zone-governance rules (see `PACKAGE_GUIDELINES.md` and
  `CLAUDE.md`). PRs that violate these boundaries will be asked to conform. The
  `ndx ci` health gate runs the same checks locally that CI enforces.
- **Include tests and pass the gates.** `pnpm typecheck` and `pnpm test` must
  pass; nontrivial changes need matching test coverage.
- **Follow the Code of Conduct.** Participation is governed by
  [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

Good first contributions: PRD items tagged `help-wanted` or `self-heal`, and
documentation gaps — see [CONTRIBUTING.md](CONTRIBUTING.md#what-to-focus-on).

---

## Trademarks

"n-dx", "ndx", and the associated logos are trademarks of En Dash Consulting.
ELv2 does not grant trademark rights. You may use the marks nominatively to
refer to the project (e.g., "built with n-dx"), but you may not use them in a
way that implies endorsement, or as the name of a derivative or competing
product, without permission.

---

## Questions

- **Bugs and feature requests** — open an issue at
  <https://github.com/en-dash-consulting/n-dx/issues>.
- **Licensing, commercial, or hosted-service questions** — email the maintainers
  at <nick@endash.us>.

---

> **Note:** This file describes the project scope at a point in time. Where it
> and [CONTRIBUTING.md](CONTRIBUTING.md) overlap on contributor workflow,
> CONTRIBUTING.md is authoritative; where they overlap on licensing, the
> [LICENSE](LICENSE) text controls.

_Copyright 2025-2026 En Dash Consulting. Licensed under the Elastic License 2.0._
