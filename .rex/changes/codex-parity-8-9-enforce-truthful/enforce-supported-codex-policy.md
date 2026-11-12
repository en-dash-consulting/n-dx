---
id: "9285e760-055c-4638-adf0-63358f35a339"
type: "task"
title: "Enforce supported Codex policy restrictions and expose capability limits"
slug: "enforce-supported-codex-policy"
description: "Translate supported restrictions through the actual installed Codex controls, while making any remaining unsupported setting explicit. Do not present an ignored control as enforced.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Enforce equivalent supported command/Git restrictions or explicitly identify unsupported controls in resolution, dashboard and errors."
  - "Tests allow intended read-only Git operations while denying disallowed Git subcommands and policy-boundary crossings."
  - "Fresh, resumed and forked sessions preserve sandbox, approval, network/filesystem and credential-isolation posture."
  - "Untrusted repository configuration cannot widen execution or silently relax approvals; unavailable versions fail safely."
  - "Provide real supported-CLI boundary evidence separately from flag/argv mocks, including the confinement needed by hub sessions."
priority: "high"
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-8"
source: "ndx-capture"
blockedBy:
  - "ee45742e-70be-47ff-a5af-22fa9b711412"
---
