---
id: "4fc913c5-82c4-4fb0-958f-ba5836822c0d"
type: "task"
title: "Fix code in rex: packages/rex/src/cli/commands/ imports from 40+ internal submodules (core/tree, "
slug: "fix-code-in-rex-packages-rex-src-cli"
description: "- packages/rex/src/cli/commands/ imports from 40+ internal submodules (core/tree, core/stats, schema/index, recommend/conflict-detection, fix/index, and 30+ others) with no boundary assertion preventing the surface from expanding. public.ts exports ~30 symbols but CLI commands bypass it entirely, creating a de-facto second internal API that is invisible to external consumers and to domain-isolation.test.js. Adding a boundary assertion — 'cli/commands/ may only import from public.ts or core/ directly' — would cap growth of this surface and make the privileged-consumer pattern explicit."
priority: "high"
source: "sourcevision"
---
