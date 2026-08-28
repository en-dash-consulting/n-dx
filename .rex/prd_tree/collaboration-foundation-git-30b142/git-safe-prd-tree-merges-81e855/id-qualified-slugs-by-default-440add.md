---
id: "440add3e-0707-4529-ac32-11d4fff41af1"
level: "task"
title: "ID-qualified slugs by default plus migrate-slugs command"
status: "completed"
priority: "high"
startedAt: "2026-08-25T22:39:23.960Z"
completedAt: "2026-08-25T23:08:33.322Z"
endedAt: "2026-08-25T23:08:33.322Z"
acceptanceCriteria: []
description: "slugify() emits title-only slugs; the -{id6} suffix only appears for long titles or same-tree sibling collisions, so same-titled items created on divergent branches collide on identical paths and renames relocate files. Make the -{id6} suffix the default for all new writes and add a one-shot 'rex migrate-slugs' command that renames the existing tree. PR boundary: serializer change + migration command + docs/architecture/prd-folder-tree-schema.md update; may split migration into its own PR if large. Acceptance criteria: (1) new items always get id-suffixed slugs; (2) migrate-slugs renames every existing entry and the parser reads the result identically; (3) idempotent - second run is a no-op; (4) schema doc updated."
---
