---
"@n-dx/web": patch
---

Dashboard command references now use the project's resolved CLI name instead of a hardcoded one. Sidebar and breadcrumb labels, page titles, FAQ answers, settings hints, and every panel's "equivalent to" snippet read from shared state, so a project whose binary is `myapp` sees `myapp work` throughout. Constant tables carry a `{cli}` placeholder resolved at render; a guard test fails the build if a bare command reference reappears in viewer source. Also removes a duplicate `document.title` writer in main.ts — Breadcrumb owns the title, and the second writer was racing it.
